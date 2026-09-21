import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { baseArgs, runJson, runRaw } from '../utils/ytdlp.js';
import { detectPlatform, instagramShortcode, isTikTokPhotoUrl } from './platforms.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAX_ITEMS = 20;
const MAX_DURATION_SECONDS = 3 * 60 * 60;

export class DownloadError extends Error {}

export async function createTempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'iqbot-'));
}

export async function removeDir(dir) {
  if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}

async function fetchText(url, timeoutMs = 15_000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await res.text(), finalUrl: new URL(res.url) };
}

async function downloadFile(url, dest, maxBytes, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (declared && declared > maxBytes) throw new DownloadError('File is larger than the upload limit.');

  let received = 0;
  const limiter = async function* (source) {
    for await (const chunk of source) {
      received += chunk.length;
      if (received > maxBytes) throw new DownloadError('File is larger than the upload limit.');
      yield chunk;
    }
  };
  await pipeline(Readable.fromWeb(res.body), limiter, fs.createWriteStream(dest));
  return { path: dest, size: received, contentType: res.headers.get('content-type') ?? '' };
}

function extFromContentType(type, fallback) {
  if (/jpe?g/i.test(type)) return 'jpg';
  if (/png/i.test(type)) return 'png';
  if (/webp/i.test(type)) return 'webp';
  if (/heic/i.test(type)) return 'heic';
  if (/mp4/i.test(type)) return 'mp4';
  return fallback;
}

async function downloadImages(urls, dir, limitBytes, headers) {
  const files = [];
  let tooLarge = 0;
  for (const [i, url] of urls.slice(0, MAX_ITEMS).entries()) {
    const tmp = path.join(dir, `image_${String(i + 1).padStart(2, '0')}`);
    try {
      const file = await downloadFile(url, tmp, limitBytes, headers);
      const finalPath = `${tmp}.${extFromContentType(file.contentType, 'jpg')}`;
      await fsp.rename(tmp, finalPath);
      files.push({ path: finalPath, size: file.size });
    } catch (err) {
      if (err instanceof DownloadError) tooLarge++;
      else logger.debug('Image download failed:', err.message);
    }
  }
  return { files, tooLarge };
}

function formatSize(f, duration) {
  if (f.filesize) return f.filesize;
  if (f.filesize_approx) return f.filesize_approx;
  if (f.tbr && duration) return (f.tbr * 1000 / 8) * duration;
  return null;
}

// Chooses the best format (or video+audio pair) whose estimated size fits under the upload limit.
export function chooseFormat(info, limitBytes) {
  const formats = (info.formats ?? []).filter((f) => f.format_id && f.protocol !== 'mhtml' && !/storyboard/i.test(f.format_note ?? ''));
  const duration = info.duration ?? null;
  const hasVideo = (f) => f.vcodec && f.vcodec !== 'none';
  const hasAudio = (f) => f.acodec && f.acodec !== 'none';
  const isH264 = (f) => /^(avc|h264)/i.test(f.vcodec ?? '');

  const candidates = [];
  for (const f of formats) {
    if (hasVideo(f) && hasAudio(f)) {
      candidates.push({ id: f.format_id, size: formatSize(f, duration), height: f.height ?? 0, h264: isH264(f) });
    }
  }
  const audios = formats
    .filter((f) => hasAudio(f) && !hasVideo(f))
    .map((f) => ({ f, size: formatSize(f, duration) }))
    .filter((a) => a.size)
    .sort((a, b) => (b.f.ext === 'm4a') - (a.f.ext === 'm4a') || (b.f.abr ?? 0) - (a.f.abr ?? 0));
  const bestAudio = audios.find((a) => a.f.ext === 'm4a' && (a.f.abr ?? 0) <= 160) ?? audios[0];
  if (bestAudio) {
    for (const f of formats) {
      if (!hasVideo(f) || hasAudio(f)) continue;
      const vSize = formatSize(f, duration);
      candidates.push({
        id: `${f.format_id}+${bestAudio.f.format_id}`,
        size: vSize ? vSize + bestAudio.size : null,
        height: Math.min(f.height ?? 0, 1080),
        h264: isH264(f) && bestAudio.f.ext === 'm4a',
      });
    }
  }

  const fitting = candidates
    .filter((c) => c.size && c.size <= limitBytes * 0.95)
    .sort((a, b) => (b.height + (b.h264 ? 400 : 0)) - (a.height + (a.h264 ? 400 : 0)) || b.size - a.size);
  if (fitting.length) return { formatId: fitting[0].id };

  const known = candidates.filter((c) => c.size);
  if (known.length && known.length === candidates.length) {
    return { tooLarge: true, smallest: Math.min(...known.map((c) => c.size)) };
  }
  return { formatId: null };
}

async function listFiles(dir) {
  const names = await fsp.readdir(dir);
  const files = [];
  for (const name of names.sort()) {
    if (name.endsWith('.part') || name.endsWith('.ytdl') || name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    const stat = await fsp.stat(full);
    if (stat.isFile()) files.push({ path: full, size: stat.size });
  }
  return files;
}

async function downloadWithYtDlp(url, dir, limitBytes, prefetchedInfo = null) {
  const info = prefetchedInfo ?? await runJson(['--no-playlist', '--playlist-items', `1-${MAX_ITEMS}`, '--', url], { timeoutMs: 60_000 });
  if (info.is_live || info.live_status === 'is_live') throw new DownloadError('Live streams cannot be downloaded.');
  if (info.duration && info.duration > MAX_DURATION_SECONDS) throw new DownloadError('That video is too long to download.');

  const title = info.title ?? info.description ?? null;
  const common = [
    ...baseArgs(),
    '--no-playlist',
    '--playlist-items', `1-${MAX_ITEMS}`,
    '--merge-output-format', 'mp4',
    '--no-mtime',
    '-o', path.join(dir, '%(autonumber)03d_%(id).60s.%(ext)s'),
  ];

  const isPlaylist = info._type === 'playlist';
  if (!isPlaylist) {
    const choice = chooseFormat(info, limitBytes);
    if (choice.tooLarge) {
      throw new DownloadError(`That video is too large to upload here (smallest version ≈ ${(choice.smallest / 1048576).toFixed(1)} MB, limit ${(limitBytes / 1048576).toFixed(0)} MB).`);
    }
    const format = choice.formatId ?? 'b[ext=mp4][height<=720]/bv*[height<=720]+ba/b';
    await runRaw([...common, '-f', format, '-S', 'vcodec:h264,ext:mp4:m4a', '--', url], { timeoutMs: 10 * 60_000 });
  } else {
    await runRaw([...common, '-f', 'b[ext=mp4]/bv*+ba/b', '-S', 'vcodec:h264,ext:mp4:m4a', '--yes-playlist', '--', url], { timeoutMs: 10 * 60_000 });
  }

  const files = await listFiles(dir);
  if (!files.length) throw new DownloadError('Nothing was downloaded.');
  const fitting = files.filter((f) => f.size <= limitBytes);
  if (!fitting.length) {
    throw new DownloadError(`The file is too large to upload here (${(files[0].size / 1048576).toFixed(1)} MB, limit ${(limitBytes / 1048576).toFixed(0)} MB).`);
  }
  return { title, files: fitting, skipped: files.length - fitting.length };
}

function parseTikTokItem(html) {
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1])?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct ?? null;
  } catch {
    return null;
  }
}

function pickImageUrl(image) {
  const list = image?.imageURL?.urlList ?? image?.displayImage?.urlList ?? [];
  return list.find((u) => /jpe?g/i.test(u)) ?? list[0] ?? null;
}

async function tikwmImages(url) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (json?.code !== 0 || !Array.isArray(json.data?.images) || !json.data.images.length) return null;
  return { title: json.data.title ?? null, urls: json.data.images };
}

async function downloadTikTokPhotos(url, dir, limitBytes) {
  let title = null;
  let urls = [];
  try {
    const { text } = await fetchText(url.href);
    const item = parseTikTokItem(text);
    urls = (item?.imagePost?.images ?? []).map(pickImageUrl).filter(Boolean);
    title = item?.imagePost?.title || item?.desc || null;
  } catch (err) {
    logger.debug('TikTok page scrape failed:', err.message);
  }
  if (!urls.length) {
    const fallback = await tikwmImages(url.href).catch(() => null);
    if (fallback) ({ title, urls } = fallback);
  }
  if (!urls.length) throw new DownloadError("Couldn't find any photos in that TikTok post.");

  const { files, tooLarge } = await downloadImages(urls, dir, limitBytes, { Referer: 'https://www.tiktok.com/' });
  if (!files.length) throw new DownloadError("Couldn't download the photos from that TikTok post.");
  return { title, files, skipped: tooLarge + Math.max(0, urls.length - MAX_ITEMS) };
}

async function instagramImages(url) {
  const shortcode = instagramShortcode(url);
  if (!shortcode) return null;
  const { text } = await fetchText(`https://www.instagram.com/p/${shortcode}/embed/captioned/`);
  const urls = new Set();
  const unescape = (s) => s.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
  for (const m of text.matchAll(/\\?"display_url\\?"\s*:\s*\\?"(https:[^"\\]+(?:\\\/[^"\\]+)*)/g)) urls.add(unescape(m[1]));
  if (!urls.size) {
    for (const m of text.matchAll(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/g)) urls.add(unescape(m[1]));
  }
  const caption = text.match(/class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return urls.size ? { urls: [...urls], title: caption || null } : null;
}

const hasVideo = (entry) => (entry?.formats ?? []).some((f) => f.vcodec && f.vcodec !== 'none');

async function downloadInstagram(url, dir, limitBytes) {
  let info;
  try {
    // Without --ignore-no-formats-error yt-dlp rejects photo posts; with it, photos come back as thumbnails.
    info = await runJson(['--ignore-no-formats-error', '--yes-playlist', '--playlist-items', `1-${MAX_ITEMS}`, '--', url.href], { timeoutMs: 60_000 });
  } catch (err) {
    const images = await instagramImages(url).catch(() => null);
    if (images) {
      const { files, tooLarge } = await downloadImages(images.urls, dir, limitBytes, { Referer: 'https://www.instagram.com/' });
      if (files.length) return { title: images.title, files, skipped: tooLarge };
    }
    if (/login|log in|rate-limit|cookies|private/i.test(err.message)) {
      throw new DownloadError('Instagram requires a login to access this post. It might be private, or the bot owner needs to set YTDLP_COOKIES.');
    }
    throw new DownloadError(`Couldn't download that Instagram post: ${err.message}`);
  }

  const isPlaylist = info._type === 'playlist';
  if (!isPlaylist && hasVideo(info)) return downloadWithYtDlp(url.href, dir, limitBytes, info);

  const entries = isPlaylist ? (info.entries ?? []).filter(Boolean).slice(0, MAX_ITEMS) : [info];
  const videoIndexes = [];
  let skipped = 0;
  for (const [i, entry] of entries.entries()) {
    const index = entry.playlist_index ?? i + 1;
    if (hasVideo(entry)) {
      videoIndexes.push(index);
      continue;
    }
    const imageUrl = entry.thumbnail ?? entry.thumbnails?.at(-1)?.url;
    if (!imageUrl) {
      skipped++;
      continue;
    }
    const tmp = path.join(dir, `${String(index).padStart(3, '0')}_image`);
    try {
      const file = await downloadFile(imageUrl, tmp, limitBytes, entry.http_headers ?? {});
      await fsp.rename(tmp, `${tmp}.${extFromContentType(file.contentType, 'jpg')}`);
    } catch (err) {
      logger.debug('Instagram image download failed:', err.message);
      await fsp.rm(tmp, { force: true }).catch(() => {});
      skipped++;
    }
  }

  if (videoIndexes.length) {
    await runRaw([
      ...baseArgs(),
      '--yes-playlist',
      '--ignore-no-formats-error',
      '--playlist-items', videoIndexes.join(','),
      '--merge-output-format', 'mp4',
      '--no-mtime',
      '-f', 'b[ext=mp4]/bv*+ba/b',
      '-S', 'vcodec:h264,ext:mp4:m4a',
      '-o', path.join(dir, '%(playlist_index)03d_video.%(ext)s'),
      '--',
      url.href,
    ], { timeoutMs: 10 * 60_000 }).catch((err) => logger.warn('Instagram video download failed:', err.message));
  }

  const all = await listFiles(dir);
  const videos = all.filter((f) => f.path.includes('_video.')).length;
  skipped += Math.max(0, videoIndexes.length - videos);
  const fitting = all.filter((f) => f.size <= limitBytes);
  skipped += all.length - fitting.length;
  if (!fitting.length) throw new DownloadError("Couldn't download anything from that Instagram post.");
  return { title: info.description ?? info.title ?? null, files: fitting, skipped };
}

async function downloadTikTok(url, dir, limitBytes) {
  let target = url;
  if (/^(vm|vt)\./i.test(url.hostname) || url.pathname.startsWith('/t/')) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (res?.url) target = new URL(res.url);
    res?.body?.cancel().catch(() => {});
  }
  if (isTikTokPhotoUrl(target)) return downloadTikTokPhotos(target, dir, limitBytes);

  try {
    return await downloadWithYtDlp(target.href, dir, limitBytes);
  } catch (err) {
    if (err instanceof DownloadError && !/Nothing was downloaded/.test(err.message)) throw err;
    // Some photo posts are served under /video/ URLs; yt-dlp can't handle those.
    try {
      return await downloadTikTokPhotos(target, dir, limitBytes);
    } catch {
      throw new DownloadError(`Couldn't download that TikTok: ${err.message}`);
    }
  }
}

let active = 0;
const waiting = [];
const activeUsers = new Set();

async function withSlot(fn) {
  if (active >= config.maxConcurrentDownloads) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export async function download(input, { userId, limitBytes }) {
  const platform = detectPlatform(input);
  if (!platform) throw new DownloadError('Only TikTok, YouTube and Instagram links are supported.');
  if (platform.key === 'youtube' && (platform.url.pathname === '/playlist' || platform.url.pathname.startsWith('/@') || platform.url.pathname.startsWith('/channel'))) {
    throw new DownloadError('Please send a link to a single YouTube video, not a playlist or channel.');
  }
  if (activeUsers.has(userId)) throw new DownloadError('You already have a download in progress. Please wait for it to finish.');

  activeUsers.add(userId);
  const dir = await createTempDir();
  try {
    const result = await withSlot(async () => {
      if (platform.key === 'tiktok') return downloadTikTok(platform.url, dir, limitBytes);
      if (platform.key === 'instagram') return downloadInstagram(platform.url, dir, limitBytes);
      return downloadWithYtDlp(platform.url.href, dir, limitBytes);
    });
    return { ...result, platform: platform.name, dir };
  } catch (err) {
    await removeDir(dir);
    if (err instanceof DownloadError) throw err;
    throw new DownloadError(err.message || 'Download failed.');
  } finally {
    activeUsers.delete(userId);
  }
}
