import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');

try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  // .env is optional; variables can come from the environment instead.
}

function readInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}").`);
  }
  return value;
}

function readString(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export const config = {
  token: readString('DISCORD_TOKEN'),
  guildId: readString('GUILD_ID'),
  spotifyClientId: readString('SPOTIFY_CLIENT_ID'),
  spotifyClientSecret: readString('SPOTIFY_CLIENT_SECRET'),
  ytdlpPath: readString('YTDLP_PATH'),
  ytdlpCookies: readString('YTDLP_COOKIES'),
  ffmpegPath: readString('FFMPEG_PATH') ?? ffmpegStatic,
  idleTimeoutMs: readInt('IDLE_TIMEOUT_MINUTES', 10, 1, 1440) * 60_000,
  aloneTimeoutMs: readInt('ALONE_TIMEOUT_MINUTES', 2, 1, 1440) * 60_000,
  maxQueueSize: readInt('MAX_QUEUE_SIZE', 1000, 1, 10_000),
  maxPlaylistSize: readInt('MAX_PLAYLIST_SIZE', 300, 1, 5000),
  maxConcurrentDownloads: readInt('MAX_CONCURRENT_DOWNLOADS', 2, 1, 10),
  embedColor: 0x5865f2,
};

export function validateConfig() {
  const problems = [];
  if (!config.token) problems.push('DISCORD_TOKEN is missing. Copy .env.example to .env and fill it in.');
  if (!config.ffmpegPath) problems.push('FFmpeg was not found. Set FFMPEG_PATH or reinstall dependencies.');
  if (Boolean(config.spotifyClientId) !== Boolean(config.spotifyClientSecret)) {
    problems.push('Set both SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, or neither.');
  }
  return problems;
}
