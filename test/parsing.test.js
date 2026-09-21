import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTube, pickBestMatch } from '../src/music/resolver.js';
import { parseSpotify, isSpotifyInput } from '../src/music/spotify.js';
import { detectPlatform, instagramShortcode, isTikTokPhotoUrl, uploadLimitBytes } from '../src/download/platforms.js';
import { chooseFormat } from '../src/download/downloader.js';
import { escapeMarkdown, formatDuration, truncate } from '../src/utils/format.js';
import { cleanError } from '../src/utils/ytdlp.js';
import { commands } from '../src/commands/index.js';

test('parseYouTube handles common URL shapes', () => {
  assert.deepEqual(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { type: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTube('https://youtu.be/dQw4w9WgXcQ?si=abc'), { type: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTube('https://m.youtube.com/shorts/dQw4w9WgXcQ'), { type: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTube('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM'), { type: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTube('https://www.youtube.com/playlist?list=PL123'), { type: 'playlist', id: 'PL123' });
  assert.equal(parseYouTube('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTube('https://www.youtube.com/watch?v=bad'), null);
  assert.equal(parseYouTube('rick astley'), null);
});

test('parseSpotify handles URLs and URIs', () => {
  const id = '37i9dQZF1DXcBWIGoYBM5M';
  assert.deepEqual(parseSpotify(`https://open.spotify.com/playlist/${id}?si=x`), { type: 'playlist', id });
  assert.deepEqual(parseSpotify(`https://open.spotify.com/intl-id/track/${id}`), { type: 'track', id });
  assert.deepEqual(parseSpotify(`spotify:album:${id}`), { type: 'album', id });
  assert.deepEqual(parseSpotify(`https://open.spotify.com/user/someone/playlist/${id}`), { type: 'playlist', id });
  assert.equal(parseSpotify('https://open.spotify.com/show/abc'), null);
  assert.equal(isSpotifyInput('https://spotify.link/abc'), true);
  assert.equal(isSpotifyInput('https://notspotify.com/x'), false);
});

test('pickBestMatch prefers a result with a similar duration', () => {
  const entries = [{ id: 'a', duration: 600 }, { id: 'b', duration: 212 }, { id: 'c', duration: 214 }];
  assert.equal(pickBestMatch(entries, 213).id, 'b');
  assert.equal(pickBestMatch(entries, null).id, 'a');
  assert.equal(pickBestMatch(entries, 30).id, 'a');
  assert.equal(pickBestMatch([], 100), null);
});

test('detectPlatform only accepts supported hosts', () => {
  assert.equal(detectPlatform('https://www.tiktok.com/@a/video/123').key, 'tiktok');
  assert.equal(detectPlatform('https://vt.tiktok.com/ZSabc/').key, 'tiktok');
  assert.equal(detectPlatform('https://youtu.be/dQw4w9WgXcQ').key, 'youtube');
  assert.equal(detectPlatform('https://www.instagram.com/reel/Cabc123/').key, 'instagram');
  assert.equal(detectPlatform('https://evil-tiktok.com.attacker.io/x'), null);
  assert.equal(detectPlatform('file:///etc/passwd'), null);
  assert.equal(detectPlatform('not a url'), null);
});

test('platform helpers', () => {
  assert.equal(isTikTokPhotoUrl(new URL('https://www.tiktok.com/@a/photo/7300000000000000000')), true);
  assert.equal(isTikTokPhotoUrl(new URL('https://www.tiktok.com/@a/video/7300000000000000000')), false);
  assert.equal(instagramShortcode(new URL('https://www.instagram.com/p/C1a2B3c4D5/')), 'C1a2B3c4D5');
  assert.equal(instagramShortcode(new URL('https://www.instagram.com/someuser/reel/C1a2B3c4D5/?igsh=1')), 'C1a2B3c4D5');
  assert.ok(uploadLimitBytes({ premiumTier: 0 }) < 10 * 1024 * 1024);
  assert.ok(uploadLimitBytes({ premiumTier: 3 }) > 90 * 1024 * 1024);
});

test('chooseFormat picks the best version that fits the limit', () => {
  const MB = 1024 * 1024;
  const info = {
    duration: 100,
    formats: [
      { format_id: '18', vcodec: 'avc1', acodec: 'mp4a', height: 360, filesize: 5 * MB, ext: 'mp4' },
      { format_id: '140', vcodec: 'none', acodec: 'mp4a', ext: 'm4a', abr: 128, filesize: 1.5 * MB },
      { format_id: '137', vcodec: 'avc1', acodec: 'none', height: 1080, filesize: 30 * MB, ext: 'mp4' },
      { format_id: '136', vcodec: 'avc1', acodec: 'none', height: 720, filesize: 7 * MB, ext: 'mp4' },
      { format_id: '399', vcodec: 'av01', acodec: 'none', height: 1080, filesize: 6 * MB, ext: 'mp4' },
    ],
  };
  assert.deepEqual(chooseFormat(info, 10 * MB), { formatId: '136+140' });
  assert.deepEqual(chooseFormat(info, 6 * MB), { formatId: '18' });
  const tooBig = chooseFormat(info, 2 * MB);
  assert.equal(tooBig.tooLarge, true);
  assert.deepEqual(chooseFormat({ formats: [{ format_id: 'x', vcodec: 'h264', acodec: 'aac' }] }, 10 * MB), { formatId: null });
});

test('format helpers', () => {
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(null), 'Live');
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(escapeMarkdown('a*b_[c]'), 'a\\*b\\_\\[c\\]');
  assert.equal(cleanError('WARNING: x\nERROR: [youtube] abc123: Video unavailable'), 'Video unavailable');
});

test('slash command definitions are valid', () => {
  const names = new Set();
  for (const [name, command] of commands) {
    const json = command.data.toJSON();
    assert.equal(json.name, name);
    assert.match(name, /^[a-z]{1,32}$/);
    assert.ok(json.description.length <= 100, `${name} description too long`);
    assert.equal(typeof command.execute, 'function');
    names.add(name);
  }
  for (const required of ['join', 'play', 'leave', 'help', 'download', 'loop', 'skip', 'pause', 'resume', 'stop']) {
    assert.ok(names.has(required), `missing /${required}`);
  }
});
