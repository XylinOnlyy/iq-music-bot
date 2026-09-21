import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { parseUrl } from '../utils/format.js';
import { runJson } from '../utils/ytdlp.js';
import { isSpotifyInput, resolveSpotify } from './spotify.js';

const YT_HOSTS = /^(www\.|m\.|music\.)?(youtube\.com|youtube-nocookie\.com)$|^youtu\.be$/i;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const UNAVAILABLE_TITLES = new Set(['[Private video]', '[Deleted video]', '[Unavailable video]']);

export class ResolveError extends Error {}

export function parseYouTube(input) {
  const url = parseUrl(input);
  if (!url || !YT_HOSTS.test(url.hostname)) return null;

  if (/^youtu\.be$/i.test(url.hostname)) {
    const id = url.pathname.slice(1).split('/')[0];
    return VIDEO_ID_RE.test(id) ? { type: 'video', id } : null;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const list = url.searchParams.get('list');
  const v = url.searchParams.get('v');
  if (list && (parts[0] === 'playlist' || (parts[0] === 'watch' && !v))) return { type: 'playlist', id: list };
  if (parts[0] === 'watch' && v && VIDEO_ID_RE.test(v)) return { type: 'video', id: v };
  if (['shorts', 'live', 'embed', 'v'].includes(parts[0]) && VIDEO_ID_RE.test(parts[1] ?? '')) return { type: 'video', id: parts[1] };
  return null;
}

export function videoUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function thumbnailFor(id, entry) {
  return entry?.thumbnail ?? entry?.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function makeTrack(fields, requester) {
  return {
    id: randomUUID(),
    title: fields.title || 'Unknown title',
    author: fields.author ?? null,
    url: fields.url ?? null,
    duration: Number.isFinite(fields.duration) ? fields.duration : null,
    thumbnail: fields.thumbnail ?? null,
    source: fields.source,
    searchQuery: fields.searchQuery ?? null,
    targetDuration: fields.targetDuration ?? null,
    spotifyUrl: fields.spotifyUrl ?? null,
    requester,
  };
}

function fromYouTubeEntry(entry, requester) {
  if (!entry?.id || !VIDEO_ID_RE.test(entry.id) || UNAVAILABLE_TITLES.has(entry.title)) return null;
  return makeTrack({
    title: entry.title,
    author: entry.channel ?? entry.uploader ?? null,
    url: videoUrl(entry.id),
    duration: entry.is_live ? null : entry.duration,
    thumbnail: thumbnailFor(entry.id, entry),
    source: 'youtube',
  }, requester);
}

export async function searchYouTube(query, count = 1) {
  const data = await runJson(['--flat-playlist', '--', `ytsearch${count}:${query}`], { timeoutMs: 30_000 });
  return (data.entries ?? []).filter((e) => e?.id && VIDEO_ID_RE.test(e.id) && !UNAVAILABLE_TITLES.has(e.title));
}

export function pickBestMatch(entries, targetSeconds) {
  if (!entries.length) return null;
  if (!targetSeconds) return entries[0];
  // Keep YouTube's ranking but skip results whose length is clearly a different edit (extended mix, live, etc.).
  const close = entries.find((e) => Number.isFinite(e.duration) && Math.abs(e.duration - targetSeconds) <= 15);
  return close ?? entries[0];
}

export async function resolveSearchTrack(track) {
  if (track.url) return track;
  const entries = await searchYouTube(track.searchQuery, track.targetDuration ? 3 : 1);
  const best = pickBestMatch(entries, track.targetDuration);
  if (!best) throw new ResolveError(`No YouTube result found for "${track.title}".`);
  track.url = videoUrl(best.id);
  track.duration ??= Number.isFinite(best.duration) ? best.duration : null;
  track.thumbnail ??= thumbnailFor(best.id, best);
  return track;
}

async function resolveYouTubeVideo(id, requester) {
  const info = await runJson(['--no-playlist', '--', videoUrl(id)], { timeoutMs: 45_000 });
  const track = fromYouTubeEntry(info, requester);
  if (!track) throw new ResolveError('That YouTube video is unavailable.');
  return { tracks: [track], playlist: null };
}

async function resolveYouTubePlaylist(id, requester) {
  const url = `https://www.youtube.com/playlist?list=${id}`;
  const data = await runJson(['--flat-playlist', '--playlist-end', String(config.maxPlaylistSize), '--', url], { timeoutMs: 90_000 });
  const tracks = (data.entries ?? []).map((e) => fromYouTubeEntry(e, requester)).filter(Boolean);
  if (!tracks.length) throw new ResolveError('That YouTube playlist is empty or private.');
  return { tracks, playlist: { name: data.title ?? 'YouTube playlist', url, thumbnail: tracks[0].thumbnail } };
}

async function resolveSpotifyInput(input, requester) {
  const result = await resolveSpotify(input);
  const tracks = result.tracks.map((t) => {
    const artist = t.artists.join(', ');
    return makeTrack({
      title: artist ? `${t.artists[0]} - ${t.title}` : t.title,
      author: artist || null,
      duration: t.durationMs ? t.durationMs / 1000 : null,
      targetDuration: t.durationMs ? t.durationMs / 1000 : null,
      thumbnail: t.thumbnail,
      source: 'spotify',
      spotifyUrl: t.url,
      searchQuery: `${artist} - ${t.title} audio`,
    }, requester);
  });
  const playlist = result.type === 'track' ? null : { name: result.name ?? 'Spotify playlist', url: result.url, thumbnail: result.thumbnail };
  return { tracks, playlist };
}

export async function resolveQuery(rawQuery, requester) {
  const query = String(rawQuery ?? '').trim();
  if (!query) throw new ResolveError('Please provide a song name or link.');
  if (query.length > 500) throw new ResolveError('That query is too long.');

  try {
    if (isSpotifyInput(query)) return await resolveSpotifyInput(query, requester);

    const url = parseUrl(query);
    if (url) {
      const yt = parseYouTube(query);
      if (!yt) throw new ResolveError('Only YouTube and Spotify links are supported. You can also type a song name.');
      return yt.type === 'playlist' ? await resolveYouTubePlaylist(yt.id, requester) : await resolveYouTubeVideo(yt.id, requester);
    }

    const [entry] = await searchYouTube(query, 1);
    const track = fromYouTubeEntry(entry, requester);
    if (!track) throw new ResolveError(`No results found for "${query}".`);
    return { tracks: [track], playlist: null };
  } catch (err) {
    if (err instanceof ResolveError) throw err;
    throw new ResolveError(err.message || 'Could not load that track.');
  }
}
