import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { parseUrl } from '../utils/format.js';

const TYPES = new Set(['track', 'album', 'playlist', 'artist']);
const ID_RE = /^[A-Za-z0-9]{22}$/;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let cachedToken = null;

export function isSpotifyInput(input) {
  const text = String(input).trim();
  if (/^spotify:/i.test(text)) return true;
  const url = parseUrl(text);
  return Boolean(url && /(^|\.)spotify\.(com|link)$/i.test(url.hostname));
}

export function parseSpotify(input) {
  const text = String(input).trim();
  const uri = text.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/i);
  if (uri) return { type: uri[1].toLowerCase(), id: uri[2] };

  const url = parseUrl(text);
  if (!url || !/^open\.spotify\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0]?.startsWith('intl-')) parts.shift();
  if (parts[0] === 'embed') parts.shift();
  if (parts[0] === 'user' && parts[2] === 'playlist') parts.splice(0, 2);
  const [type, id] = parts;
  if (!TYPES.has(type) || !ID_RE.test(id ?? '')) return null;
  return { type, id };
}

async function expandShortLink(input) {
  const url = parseUrl(input);
  if (!url || !/(^|\.)spotify\.link$/i.test(url.hostname)) return input;
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  return res.url;
}

function spotifyUrl(type, id) {
  return `https://open.spotify.com/${type}/${id}`;
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const auth = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Spotify auth failed (HTTP ${res.status}).`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function api(pathOrUrl) {
  const token = await getToken();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.spotify.com/v1${pathOrUrl}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Spotify API returned HTTP ${res.status}.`);
  return res.json();
}

function fromApiTrack(t) {
  if (!t || t.type !== 'track' || !t.id) return null;
  return {
    title: t.name,
    artists: (t.artists ?? []).map((a) => a.name),
    durationMs: t.duration_ms ?? null,
    url: spotifyUrl('track', t.id),
    thumbnail: t.album?.images?.[0]?.url ?? null,
  };
}

async function collectPages(first, pick, limit) {
  const tracks = [];
  let page = first;
  while (page) {
    for (const item of page.items ?? []) {
      const track = fromApiTrack(pick(item));
      if (track) tracks.push(track);
      if (tracks.length >= limit) return tracks;
    }
    page = page.next ? await api(page.next) : null;
  }
  return tracks;
}

async function resolveWithApi({ type, id }, limit) {
  if (type === 'track') {
    const track = fromApiTrack(await api(`/tracks/${id}`));
    return { type, name: track?.title, tracks: track ? [track] : [] };
  }
  if (type === 'album') {
    const album = await api(`/albums/${id}`);
    const cover = album.images?.[0]?.url ?? null;
    const tracks = await collectPages(album.tracks, (item) => ({ ...item, type: 'track', album: { images: album.images } }), limit);
    return { type, name: album.name, thumbnail: cover, tracks };
  }
  if (type === 'playlist') {
    const meta = await api(`/playlists/${id}?fields=name,images`);
    const first = await api(`/playlists/${id}/tracks?limit=100&additional_types=track`);
    const tracks = await collectPages(first, (item) => item.track, limit);
    return { type, name: meta.name, thumbnail: meta.images?.[0]?.url ?? null, tracks };
  }
  const artist = await api(`/artists/${id}`);
  const top = await api(`/artists/${id}/top-tracks?market=US`);
  return { type, name: `${artist.name} - Top tracks`, tracks: (top.tracks ?? []).map(fromApiTrack).filter(Boolean).slice(0, limit) };
}

async function resolveWithEmbed({ type, id }, limit) {
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error('That Spotify link does not exist or is private.');
  if (!res.ok) throw new Error(`Spotify returned HTTP ${res.status}.`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Could not read that Spotify page.');
  const entity = JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('That Spotify link does not exist or is private.');

  const thumbnail = entity.coverArt?.sources?.[0]?.url ?? entity.visualIdentity?.image?.[0]?.url ?? null;
  if (type === 'track') {
    return {
      type,
      name: entity.name,
      tracks: [{
        title: entity.name ?? entity.title,
        artists: (entity.artists ?? []).map((a) => a.name),
        durationMs: entity.duration ?? null,
        url: spotifyUrl('track', id),
        thumbnail,
      }],
    };
  }

  const tracks = (entity.trackList ?? [])
    .filter((t) => t.entityType === 'track' || t.uri?.startsWith('spotify:track:'))
    .slice(0, limit)
    .map((t) => ({
      title: t.title,
      artists: String(t.subtitle ?? '').split(/,\s*/).filter(Boolean),
      durationMs: t.duration ?? null,
      url: t.uri ? spotifyUrl('track', t.uri.split(':').pop()) : null,
      thumbnail,
    }));
  const name = type === 'artist' ? `${entity.name} - Top tracks` : entity.name;
  return { type, name, thumbnail, tracks };
}

export async function resolveSpotify(input, limit = config.maxPlaylistSize) {
  const parsed = parseSpotify(await expandShortLink(input));
  if (!parsed) throw new Error('That Spotify link is not supported. Use a track, album, playlist or artist link.');

  let result = null;
  if (config.spotifyClientId && config.spotifyClientSecret) {
    try {
      result = await resolveWithApi(parsed, limit);
    } catch (err) {
      logger.warn(`Spotify API failed for ${parsed.type}/${parsed.id}, using embed fallback:`, err.message);
    }
  }
  // The public embed only lists the first 100 tracks, so the API is preferred when credentials exist.
  if (!result || result.tracks.length === 0) result = await resolveWithEmbed(parsed, limit);
  if (result.tracks.length === 0) throw new Error('No playable tracks were found in that Spotify link.');
  return { ...result, url: spotifyUrl(parsed.type, parsed.id) };
}
