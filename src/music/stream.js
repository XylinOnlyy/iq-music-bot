import { spawn } from 'node:child_process';
import { createAudioResource, StreamType } from '@discordjs/voice';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { baseArgs, cleanError, getYtDlpPath } from '../utils/ytdlp.js';

export function createTrackResource(track) {
  const ytdlp = spawn(getYtDlpPath(), [
    ...baseArgs(),
    '--no-playlist',
    '--quiet',
    '-f', 'bestaudio[acodec=opus]/bestaudio/best',
    '-o', '-',
    '--',
    track.url,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

  const ffmpeg = spawn(config.ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', 'pipe:0',
    '-vn',
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-f', 'ogg',
    'pipe:1',
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  let ytdlpErr = '';
  let ffmpegErr = '';
  ytdlp.stderr.setEncoding('utf8').on('data', (d) => { if (ytdlpErr.length < 8192) ytdlpErr += d; });
  ffmpeg.stderr.setEncoding('utf8').on('data', (d) => { if (ffmpegErr.length < 8192) ffmpegErr += d; });

  ytdlp.stdout.pipe(ffmpeg.stdin);
  // EPIPE is expected when a track is skipped and ffmpeg exits before yt-dlp.
  ffmpeg.stdin.on('error', () => {});
  ytdlp.stdout.on('error', () => {});
  ytdlp.on('error', (err) => logger.error('yt-dlp spawn error:', err.message));
  ffmpeg.on('error', (err) => logger.error('ffmpeg spawn error:', err.message));

  let killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    ytdlp.stdout.unpipe(ffmpeg.stdin);
    if (ytdlp.exitCode === null) ytdlp.kill('SIGKILL');
    if (ffmpeg.exitCode === null) ffmpeg.kill('SIGKILL');
  };

  const getError = () => {
    if (ytdlpErr.trim()) return cleanError(ytdlpErr);
    if (ffmpegErr.trim()) return ffmpegErr.trim().split(/\r?\n/).at(-1).slice(0, 300);
    return null;
  };

  ffmpeg.stdout.on('close', () => setTimeout(kill, 1000).unref());

  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus, metadata: track });
  return { resource, kill, getError };
}
