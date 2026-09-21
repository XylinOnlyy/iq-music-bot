import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, ROOT_DIR } from '../config.js';
import { logger } from './logger.js';

const BIN_DIR = path.join(ROOT_DIR, 'bin');
const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';

let binaryPath = null;

function releaseAssetName() {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'arm64' ? 'yt-dlp_arm64.exe' : arch === 'ia32' ? 'yt-dlp_x86.exe' : 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') {
    if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (arch === 'arm') return 'yt-dlp_linux_armv7l';
    return 'yt-dlp_linux';
  }
  return 'yt-dlp';
}

async function downloadBinary(target) {
  const asset = releaseAssetName();
  logger.info(`Downloading yt-dlp (${asset})...`);
  const res = await fetch(RELEASE_BASE + asset, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Failed to download yt-dlp: HTTP ${res.status}`);
  await fsp.mkdir(BIN_DIR, { recursive: true });
  const tmp = `${target}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  await fsp.rename(tmp, target);
  if (process.platform !== 'win32') await fsp.chmod(target, 0o755);
}

export async function ensureYtDlp() {
  if (config.ytdlpPath) {
    binaryPath = config.ytdlpPath;
  } else {
    binaryPath = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    if (!fs.existsSync(binaryPath)) {
      await downloadBinary(binaryPath);
    } else {
      // YouTube changes often, so an outdated yt-dlp is the most common cause of playback failures.
      await runRaw(['-U'], { timeoutMs: 90_000 }).catch((err) => logger.warn('yt-dlp self-update failed:', err.message));
    }
  }
  const version = (await runRaw(['--version'], { timeoutMs: 30_000 })).trim();
  logger.info(`yt-dlp ${version} ready.`);
  return version;
}

export function getYtDlpPath() {
  if (!binaryPath) throw new Error('yt-dlp has not been initialised.');
  return binaryPath;
}

export function baseArgs() {
  const args = [
    '--ignore-config',
    '--no-warnings',
    '--no-progress',
    '--js-runtimes', `node:${process.execPath}`,
    '--ffmpeg-location', config.ffmpegPath,
  ];
  if (config.ytdlpCookies) args.push('--cookies', config.ytdlpCookies);
  return args;
}

export function cleanError(stderr) {
  const lines = String(stderr ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errorLine = [...lines].reverse().find((l) => l.startsWith('ERROR:')) ?? lines.at(-1) ?? 'Unknown error';
  return errorLine
    .replace(/^ERROR:\s*/, '')
    .replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, '')
    .replace(/\s*Use --cookies.*$/i, '')
    .slice(0, 300);
}

export function runRaw(args, { timeoutMs = 60_000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(getYtDlpPath(), args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error('yt-dlp timed out.'));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > maxBuffer) {
        child.kill('SIGKILL');
        finish(reject, new Error('yt-dlp output was too large.'));
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, stdout);
      else finish(reject, new Error(cleanError(stderr)));
    });
  });
}

export async function runJson(args, options) {
  const out = await runRaw([...baseArgs(), '-J', ...args], options);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error('Could not parse yt-dlp output.');
  }
}
