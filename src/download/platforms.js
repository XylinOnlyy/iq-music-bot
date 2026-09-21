import { parseUrl } from '../utils/format.js';

const PLATFORMS = [
  { name: 'TikTok', key: 'tiktok', re: /(^|\.)tiktok\.com$/i },
  { name: 'YouTube', key: 'youtube', re: /^((www|m|music)\.)?youtube\.com$|^youtu\.be$/i },
  { name: 'Instagram', key: 'instagram', re: /(^|\.)instagram\.com$|^instagr\.am$/i },
];

export function detectPlatform(input) {
  const url = parseUrl(input);
  if (!url) return null;
  const platform = PLATFORMS.find((p) => p.re.test(url.hostname));
  return platform ? { ...platform, url } : null;
}

export function isTikTokPhotoUrl(url) {
  return /\/photo\/\d+/.test(url.pathname);
}

export function tiktokItemId(url) {
  return url.pathname.match(/\/(?:video|photo|v)\/(\d+)/)?.[1] ?? null;
}

export function instagramShortcode(url) {
  return url.pathname.match(/\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

export function uploadLimitBytes(guild) {
  const tier = guild?.premiumTier ?? 0;
  const mb = tier >= 3 ? 100 : tier === 2 ? 50 : 10;
  // Leave headroom for multipart overhead so uploads right at the limit don't get rejected.
  return mb * 1024 * 1024 - 256 * 1024;
}
