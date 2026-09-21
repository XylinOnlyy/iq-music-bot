export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return 'Live';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function truncate(text, max) {
  const str = String(text ?? '');
  return str.length > max ? `${str.slice(0, Math.max(0, max - 1))}…` : str;
}

export function escapeMarkdown(text) {
  return String(text ?? '').replace(/([\\*_`~|>[\]()])/g, '\\$1');
}

export function trackLink(track, max = 80) {
  const title = escapeMarkdown(truncate(track.title, max));
  const url = track.url ?? track.spotifyUrl;
  return url ? `[${title}](${url})` : title;
}

export function parseUrl(input) {
  try {
    const url = new URL(String(input).trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
