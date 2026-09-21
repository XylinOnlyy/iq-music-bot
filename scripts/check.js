// Live health check: verifies FFmpeg, yt-dlp, YouTube, Spotify and the downloader actually work from this machine.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR, validateConfig } from '../src/config.js';
import { ensureYtDlp } from '../src/utils/ytdlp.js';

const results = [];

async function step(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name} (${Date.now() - start} ms)${detail ? ` - ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`✖ ${name} - ${err.message}`);
  }
}

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

await step('Configuration', () => {
  const problems = validateConfig().filter((p) => !p.startsWith('DISCORD_TOKEN'));
  if (problems.length) throw new Error(problems.join(' '));
  return config.token ? 'token set' : 'DISCORD_TOKEN not set yet (needed to run the bot)';
});

await step('Syntax of all source files', () => {
  const files = listJsFiles(path.join(ROOT_DIR, 'src'));
  for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  return `${files.length} files`;
});

await step('Modules load', async () => {
  const { commands } = await import('../src/commands/index.js');
  await import('../src/buttons.js');
  return `${commands.size} commands`;
});

await step('FFmpeg with libopus', () => {
  const out = execFileSync(config.ffmpegPath, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  if (!/libopus/.test(out)) throw new Error('FFmpeg has no libopus encoder.');
});

await step('Voice encryption and DAVE', async () => {
  const { generateDependencyReport } = await import('@discordjs/voice');
  const report = generateDependencyReport();
  if (!/@snazzah\/davey: \d/.test(report)) throw new Error('DAVE library (@snazzah/davey) is missing.');
  return 'ok';
});

let ytdlpReady = false;
await step('yt-dlp', async () => {
  const version = await ensureYtDlp();
  ytdlpReady = true;
  return version;
});

if (ytdlpReady) {
  const { resolveQuery, resolveSearchTrack } = await import('../src/music/resolver.js');
  const { createTrackResource } = await import('../src/music/stream.js');
  const requester = { id: '0', tag: 'check' };

  await step('YouTube search', async () => {
    const { tracks } = await resolveQuery('rick astley never gonna give you up', requester);
    return tracks[0].title;
  });

  await step('YouTube video link', async () => {
    const { tracks } = await resolveQuery('https://youtu.be/dQw4w9WgXcQ', requester);
    return `${tracks[0].title} (${tracks[0].duration}s)`;
  });

  await step('Spotify playlist → YouTube', async () => {
    const { tracks, playlist } = await resolveQuery('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', requester);
    const first = await resolveSearchTrack(tracks[0]);
    return `${playlist.name}: ${tracks.length} tracks, first → ${first.url}`;
  });

  await step('Invalid input is rejected', async () => {
    try {
      await resolveQuery('https://example.com/song.mp3', requester);
    } catch (err) {
      return err.message;
    }
    throw new Error('An unsupported link was accepted.');
  });

  await step('Audio stream produces Opus packets', () => new Promise((resolve, reject) => {
    const stream = createTrackResource({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'check' });
    let packets = 0;
    const timer = setTimeout(() => { stream.kill(); reject(new Error(stream.getError() ?? 'No audio within 60s.')); }, 60_000);
    stream.resource.playStream.on('data', () => {
      if (++packets === 250) {
        clearTimeout(timer);
        stream.kill();
        resolve('5 seconds of audio received');
      }
    });
    stream.resource.playStream.on('end', () => {
      if (packets < 250) { clearTimeout(timer); reject(new Error(stream.getError() ?? 'Stream ended early.')); }
    });
  }));

  await step('Broken video reports an error', () => new Promise((resolve, reject) => {
    const stream = createTrackResource({ url: 'https://www.youtube.com/watch?v=xxxxxxxxxxx', title: 'broken' });
    stream.resource.playStream.on('data', () => {});
    stream.resource.playStream.on('end', () => {
      setTimeout(() => {
        const error = stream.getError();
        if (error) resolve(error); else reject(new Error('No error message was captured.'));
      }, 500);
    });
  }));

  const { download, removeDir } = await import('../src/download/downloader.js');
  const limitBytes = 10 * 1024 * 1024 - 256 * 1024;
  for (const [name, url] of [
    ['Download TikTok video', 'https://www.tiktok.com/@snipfeedofficial/video/7185715722394357034'],
    ['Download YouTube video', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'],
  ]) {
    await step(name, async () => {
      const result = await download(url, { userId: name, limitBytes });
      await removeDir(result.dir);
      return result.files.map((f) => `${path.basename(f.path)} ${(f.size / 1048576).toFixed(1)} MB`).join(', ');
    });
  }

  await step('Oversized video is rejected before downloading', async () => {
    try {
      const result = await download('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { userId: 'big', limitBytes: 1024 * 1024 });
      await removeDir(result.dir);
    } catch (err) {
      return err.message;
    }
    throw new Error('A file larger than the limit was accepted.');
  });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
