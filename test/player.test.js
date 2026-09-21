import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GuildPlayer } from '../src/music/GuildPlayer.js';

class FakeAudioPlayer extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'idle' };
  }

  setState(state) {
    const old = this.state;
    this.state = state;
    this.emit('stateChange', old, state);
  }

  play(resource) {
    this.setState({ status: 'buffering', resource });
    if (resource.fail) this.setState({ status: 'idle' });
    else this.setState({ status: 'playing', resource });
  }

  finish() {
    this.state.resource.playbackDuration = 60_000;
    this.setState({ status: 'idle' });
  }

  stop() {
    if (this.state.status !== 'idle') this.setState({ status: 'idle' });
    return true;
  }

  pause() {
    this.setState({ ...this.state, status: 'paused' });
  }

  unpause() {
    this.setState({ ...this.state, status: 'playing' });
  }
}

const tick = () => new Promise((r) => setImmediate(r));

function makePlayer({ failing = new Set(), resolveDelay = 0 } = {}) {
  const player = new GuildPlayer({ delete() {} }, { id: 'guild', channels: { cache: new Map() } });
  const fake = new FakeAudioPlayer();
  player.attachAudioPlayer(fake);
  const played = [];
  player.resolveTrack = async (track) => {
    if (resolveDelay) await new Promise((r) => setTimeout(r, resolveDelay));
    track.url ??= `https://youtube.com/watch?v=${track.title}`;
    return track;
  };
  player.createResource = (track) => {
    played.push(track.title);
    const fail = failing.has(track.title);
    return {
      resource: { metadata: track, playbackDuration: 0, fail },
      kill() {},
      getError: () => (fail ? 'boom' : null),
    };
  };
  return { player, fake, played };
}

const tracks = (...names) => names.map((title) => ({ id: title, title, requester: { id: '1' }, source: 'youtube' }));

test('plays the queue in order and stops at the end', async () => {
  const { player, fake, played } = makePlayer();
  player.enqueue(tracks('a', 'b', 'c'));
  await player.startIfIdle();
  fake.finish(); await tick();
  fake.finish(); await tick();
  fake.finish(); await tick();
  assert.deepEqual(played, ['a', 'b', 'c']);
  assert.equal(player.current, null);
  assert.ok(player.idleTimer, 'idle timer should start after the queue ends');
  player.destroy();
});

test('loop track repeats until skipped', async () => {
  const { player, fake, played } = makePlayer();
  player.enqueue(tracks('a', 'b'));
  player.setLoop('track');
  await player.startIfIdle();
  fake.finish(); await tick();
  fake.finish(); await tick();
  player.skip(); await tick();
  assert.deepEqual(played, ['a', 'a', 'a', 'b']);
  player.destroy();
});

test('loop queue cycles through all tracks', async () => {
  const { player, fake, played } = makePlayer();
  player.enqueue(tracks('a', 'b'));
  player.setLoop('queue');
  await player.startIfIdle();
  for (let i = 0; i < 4; i++) { fake.finish(); await tick(); }
  assert.deepEqual(played, ['a', 'b', 'a', 'b', 'a']);
  assert.equal(player.idleTimer, null);
  player.destroy();
});

test('cycleLoop goes off -> track -> queue -> off', () => {
  const { player } = makePlayer();
  assert.equal(player.cycleLoop(), 'track');
  assert.equal(player.cycleLoop(), 'queue');
  assert.equal(player.cycleLoop(), 'off');
  player.destroy();
});

test('a failing track is skipped and the next one plays', async () => {
  const { player, played } = makePlayer({ failing: new Set(['bad']) });
  player.enqueue(tracks('bad', 'good'));
  await player.startIfIdle();
  await tick(); await tick();
  assert.deepEqual(played, ['bad', 'good']);
  assert.equal(player.current.title, 'good');
  player.destroy();
});

test('a failing track is not kept in loop queue or loop track', async () => {
  for (const mode of ['queue', 'track']) {
    const { player, fake, played } = makePlayer({ failing: new Set(['bad']) });
    player.enqueue(tracks('bad', 'good'));
    player.setLoop(mode);
    await player.startIfIdle();
    await tick(); await tick();
    fake.finish(); await tick();
    fake.finish(); await tick();
    assert.ok(played.filter((t) => t === 'bad').length === 1, `${mode}: bad track retried: ${played}`);
    player.destroy();
  }
});

test('too many failures in a row clears the queue', async () => {
  const names = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'ok'];
  const { player, played } = makePlayer({ failing: new Set(names.slice(0, 6)) });
  player.enqueue(tracks(...names));
  await player.startIfIdle();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(played.length, 5);
  assert.equal(player.queue.length, 0);
  assert.equal(player.current, null);
  player.destroy();
});

test('stop clears everything and does not advance', async () => {
  const { player, played } = makePlayer();
  player.enqueue(tracks('a', 'b'));
  player.setLoop('queue');
  await player.startIfIdle();
  player.stop(); await tick();
  assert.deepEqual(played, ['a']);
  assert.equal(player.current, null);
  assert.equal(player.queue.length, 0);
  assert.equal(player.loopMode, 'off');
  assert.throws(() => player.stop(), /Nothing is playing/);
  player.destroy();
});

test('skipping while a track is still resolving does not double-play', async () => {
  const { player, played } = makePlayer({ resolveDelay: 30 });
  player.enqueue(tracks('a', 'b', 'c'));
  const start = player.startIfIdle();
  player.skip();
  await start;
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(played, ['b']);
  assert.equal(player.current.title, 'b');
  player.destroy();
});

test('pause and resume toggle state and validate', async () => {
  const { player } = makePlayer();
  assert.throws(() => player.pause(), /Nothing is playing/);
  player.enqueue(tracks('a'));
  await player.startIfIdle();
  assert.equal(player.togglePause(), true);
  assert.throws(() => player.pause(), /already paused/);
  assert.equal(player.togglePause(), false);
  assert.throws(() => player.resume(), /not paused/);
  player.destroy();
});

test('remove, shuffle and clear validate input', async () => {
  const { player } = makePlayer();
  player.enqueue(tracks('now', 'a', 'b', 'c'));
  await player.startIfIdle();
  assert.throws(() => player.remove(0), /Position/);
  assert.throws(() => player.remove(4), /Position/);
  assert.equal(player.remove(2).title, 'b');
  player.shuffle();
  assert.equal(player.queue.length, 2);
  assert.equal(player.clearQueue(), 2);
  assert.throws(() => player.shuffle(), /at least 2/);
  player.destroy();
});

test('destroy is idempotent and stops playback', async () => {
  const { player, played } = makePlayer();
  player.enqueue(tracks('a', 'b'));
  await player.startIfIdle();
  player.destroy();
  player.destroy();
  await tick();
  assert.deepEqual(played, ['a']);
  assert.equal(player.destroyed, true);
});
