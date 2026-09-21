import {
  AudioPlayerStatus,
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { trackLink } from '../utils/format.js';
import { humanCount, UserError } from '../utils/voice.js';
import { buildControls, buildNowPlayingEmbed, errorEmbed, simpleEmbed, COLORS } from './controls.js';
import { resolveSearchTrack } from './resolver.js';
import { createTrackResource } from './stream.js';

const LOOP_MODES = ['off', 'track', 'queue'];
const MAX_ERRORS_IN_ROW = 5;

export class GuildPlayer {
  constructor(manager, guild) {
    this.manager = manager;
    this.guild = guild;
    this.queue = [];
    this.current = null;
    this.loopMode = 'off';
    this.textChannel = null;
    this.connection = null;
    this.stream = null;
    this.nowPlayingMessage = null;
    this.idleTimer = null;
    this.aloneTimer = null;
    this.errorsInRow = 0;
    this.skipLoopOnce = false;
    this.stopped = false;
    this.loading = false;
    this.playToken = 0;
    this.destroyed = false;
    this.resolveTrack = resolveSearchTrack;
    this.createResource = createTrackResource;
    this.attachAudioPlayer(createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }));
  }

  attachAudioPlayer(audioPlayer) {
    this.audioPlayer?.removeAllListeners();
    this.audioPlayer = audioPlayer;
    this.audioPlayer.on('stateChange', (oldState, newState) => {
      if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
        this.onTrackEnd(oldState.resource, oldState.status);
      } else if (newState.status === AudioPlayerStatus.Playing && newState.resource !== this.announcedResource) {
        this.onTrackStart(newState.resource);
      }
    });
    this.audioPlayer.on('error', (err) => {
      logger.warn(`[${this.guild.id}] Audio player error:`, err.message);
      this.lastPlayerError = err.message;
    });
  }

  get isPaused() {
    const status = this.audioPlayer.state.status;
    return status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused;
  }

  get isActive() {
    return Boolean(this.current) || this.loading;
  }

  get channelId() {
    return this.connection?.joinConfig.channelId ?? null;
  }

  async connect(channel) {
    if (this.destroyed) throw new Error('Player was destroyed.');
    if (this.connection && this.channelId === channel.id && this.connection.state.status !== VoiceConnectionStatus.Destroyed) return;

    const existing = this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed;
    const connection = existing
      ? this.connection
      : joinVoiceChannel({
        channelId: channel.id,
        guildId: this.guild.id,
        adapterCreator: this.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

    if (existing) {
      connection.rejoin({ channelId: channel.id, selfDeaf: true, selfMute: false });
    } else {
      this.connection = connection;
      this.attachConnectionHandlers(connection);
      connection.subscribe(this.audioPlayer);
    }

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.destroy();
      throw new UserError(`I couldn't connect to ${channel}. Please try again.`);
    }

    if (channel.type === ChannelType.GuildStageVoice) {
      const me = this.guild.members.me;
      if (channel.permissionsFor(me)?.has(PermissionFlagsBits.MuteMembers)) {
        await me.voice.setSuppressed(false).catch(() => {});
      } else {
        await me.voice.setRequestToSpeak(true).catch(() => {});
      }
    }
    this.checkAlone();
  }

  attachConnectionHandlers(connection) {
    connection.on('stateChange', async (_old, newState) => {
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        if (newState.reason === VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
          // 4014 means we were moved or kicked; give Discord a moment to tell us which.
          try {
            await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
          } catch {
            this.destroy();
          }
        } else if (connection.rejoinAttempts < 5) {
          await new Promise((r) => setTimeout(r, (connection.rejoinAttempts + 1) * 2_000));
          if (connection.state.status === VoiceConnectionStatus.Disconnected) connection.rejoin();
        } else {
          this.destroy();
        }
      } else if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.destroy();
      }
    });
    connection.on('error', (err) => logger.warn(`[${this.guild.id}] Voice connection error:`, err.message));
  }

  setTextChannel(channel) {
    if (channel?.isTextBased?.()) this.textChannel = channel;
  }

  enqueue(tracks) {
    const space = Math.max(0, config.maxQueueSize - this.queue.length);
    const accepted = tracks.slice(0, space);
    this.queue.push(...accepted);
    if (accepted.length) this.clearIdleTimer();
    return accepted.length;
  }

  async startIfIdle() {
    if (!this.current && !this.loading) await this.playNext();
  }

  async playNext() {
    if (this.destroyed) return;
    const token = ++this.playToken;
    this.clearIdleTimer();
    this.stopped = false;

    if (this.current && this.loopMode === 'track' && !this.skipLoopOnce) {
      // Replay the same track.
    } else {
      if (this.current && this.loopMode === 'queue') this.queue.push(this.current);
      this.current = this.queue.shift() ?? null;
    }
    this.skipLoopOnce = false;

    if (!this.current) {
      this.onQueueEnd();
      return;
    }

    const track = this.current;
    this.loading = true;
    try {
      await this.resolveTrack(track);
    } catch (err) {
      if (token !== this.playToken || this.destroyed) return;
      this.loading = false;
      await this.handleTrackFailure(track, err.message);
      return;
    }
    if (token !== this.playToken || this.destroyed) return;

    this.loading = false;
    this.stream?.kill();
    const stream = this.createResource(track);
    this.stream = stream;
    this.lastPlayerError = null;

    clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => {
      // A stalled yt-dlp never produces audio; killing it ends the resource and triggers the failure path.
      if (this.stream === stream && this.audioPlayer.state.status === AudioPlayerStatus.Buffering) {
        this.stalled = true;
        stream.kill();
      }
    }, 30_000);
    this.audioPlayer.play(stream.resource);
  }

  onTrackStart(resource) {
    const track = resource?.metadata;
    if (!track || track !== this.current) return;
    this.announcedResource = resource;
    clearTimeout(this.startTimer);
    if (this.announcedTrack === track && this.nowPlayingMessage) {
      this.refreshNowPlaying();
    } else {
      this.announcedTrack = track;
      this.sendNowPlaying().catch(() => {});
    }
    this.prefetchNext();
  }

  async handleTrackFailure(track, message) {
    logger.warn(`[${this.guild.id}] Failed to play "${track.title}":`, message);
    this.errorsInRow++;
    this.stream?.kill();
    this.stream = null;
    await this.send({ embeds: [errorEmbed(`Couldn't play ${trackLink(track, 80)}: ${message}`)] });
    this.skipLoopOnce = true;
    if (this.loopMode === 'queue') {
      // Don't keep a broken track in the loop.
      this.current = null;
    }
    if (this.errorsInRow >= MAX_ERRORS_IN_ROW) {
      this.errorsInRow = 0;
      this.queue = [];
      this.current = null;
      await this.send({ embeds: [errorEmbed('Too many tracks failed in a row, so I cleared the queue.')] });
      this.onQueueEnd();
      return;
    }
    await this.playNext();
  }

  onTrackEnd(resource, previousStatus) {
    clearTimeout(this.startTimer);
    if (this.destroyed || this.stopped) return;
    const track = resource?.metadata;
    if (!track || track !== this.current) return;

    const playedMs = resource.playbackDuration ?? 0;
    const streamError = this.stream?.getError();
    const stalled = this.stalled;
    this.stalled = false;
    this.stream?.kill();
    this.stream = null;

    const neverStarted = previousStatus === AudioPlayerStatus.Buffering;
    const userSkipped = this.skipLoopOnce;
    if (!userSkipped && (neverStarted || (playedMs < 2_000 && (streamError || this.lastPlayerError)))) {
      const reason = stalled ? 'The stream took too long to start.' : streamError ?? this.lastPlayerError ?? 'The stream ended unexpectedly.';
      this.handleTrackFailure(track, reason).catch((err) => logger.error('Track failure handler crashed:', err));
      return;
    }
    this.errorsInRow = 0;
    this.playNext().catch((err) => logger.error('playNext crashed:', err));
  }

  prefetchNext() {
    const next = this.queue[0];
    if (next && !next.url) this.resolveTrack(next).catch(() => {});
  }

  onQueueEnd() {
    this.current = null;
    this.loading = false;
    this.clearNowPlaying();
    this.startIdleTimer(true);
  }

  startIdleTimer(announce = false) {
    this.clearIdleTimer();
    if (announce) {
      const minutes = Math.round(config.idleTimeoutMs / 60_000);
      this.send({ embeds: [simpleEmbed(`✅ The queue has ended. I'll leave in ${minutes} minute(s) if nothing else is played.`)] });
    }
    this.idleTimer = setTimeout(() => {
      if (this.isActive) return;
      const minutes = Math.round(config.idleTimeoutMs / 60_000);
      this.send({ embeds: [simpleEmbed(`👋 Left the voice channel after ${minutes} minute(s) of inactivity.`, COLORS.warn)] });
      this.destroy();
    }, config.idleTimeoutMs);
  }

  clearIdleTimer() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  checkAlone() {
    const channel = this.channelId ? this.guild.channels.cache.get(this.channelId) : null;
    if (!channel) return;
    if (humanCount(channel) > 0) {
      clearTimeout(this.aloneTimer);
      this.aloneTimer = null;
      return;
    }
    if (this.aloneTimer) return;
    this.aloneTimer = setTimeout(() => {
      const ch = this.channelId ? this.guild.channels.cache.get(this.channelId) : null;
      if (ch && humanCount(ch) > 0) return;
      this.send({ embeds: [simpleEmbed('👋 Left the voice channel because everyone left.', COLORS.warn)] });
      this.destroy();
    }, config.aloneTimeoutMs);
  }

  pause() {
    if (!this.current || this.loading) throw new UserError('Nothing is playing right now.');
    if (this.isPaused) throw new UserError('The music is already paused.');
    this.audioPlayer.pause(true);
    this.refreshNowPlaying();
  }

  resume() {
    if (!this.current) throw new UserError('Nothing is playing right now.');
    if (!this.isPaused) throw new UserError('The music is not paused.');
    this.audioPlayer.unpause();
    this.refreshNowPlaying();
  }

  togglePause() {
    if (this.isPaused) this.resume();
    else this.pause();
    return this.isPaused;
  }

  skip() {
    if (!this.current && !this.loading) throw new UserError('Nothing is playing right now.');
    const skipped = this.current;
    this.skipLoopOnce = true;
    this.errorsInRow = 0;
    if (this.audioPlayer.state.status === AudioPlayerStatus.Idle) {
      this.playNext().catch((err) => logger.error('playNext crashed:', err));
    } else {
      this.audioPlayer.stop(true);
    }
    return skipped;
  }

  stop() {
    if (!this.current && !this.loading && !this.queue.length) throw new UserError('Nothing is playing right now.');
    this.stopped = true;
    clearTimeout(this.startTimer);
    this.queue = [];
    this.current = null;
    this.loopMode = 'off';
    this.playToken++;
    this.loading = false;
    this.audioPlayer.stop(true);
    this.stream?.kill();
    this.stream = null;
    this.clearNowPlaying();
    this.startIdleTimer(false);
  }

  setLoop(mode) {
    if (!LOOP_MODES.includes(mode)) throw new UserError('Invalid loop mode.');
    this.loopMode = mode;
    this.refreshNowPlaying();
    return mode;
  }

  cycleLoop() {
    return this.setLoop(LOOP_MODES[(LOOP_MODES.indexOf(this.loopMode) + 1) % LOOP_MODES.length]);
  }

  shuffle() {
    if (this.queue.length < 2) throw new UserError('There need to be at least 2 tracks in the queue to shuffle.');
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.refreshNowPlaying();
  }

  remove(position) {
    if (position < 1 || position > this.queue.length) throw new UserError(`Position must be between 1 and ${this.queue.length || 1}.`);
    const [removed] = this.queue.splice(position - 1, 1);
    this.refreshNowPlaying();
    return removed;
  }

  clearQueue() {
    const count = this.queue.length;
    this.queue = [];
    this.refreshNowPlaying();
    return count;
  }

  async send(payload) {
    if (!this.textChannel) return null;
    try {
      return await this.textChannel.send(payload);
    } catch (err) {
      logger.debug(`[${this.guild.id}] Could not send message:`, err.message);
      return null;
    }
  }

  async sendNowPlaying() {
    await this.clearNowPlaying();
    this.nowPlayingMessage = await this.send({ embeds: [buildNowPlayingEmbed(this)], components: buildControls(this) });
  }

  refreshNowPlaying() {
    if (!this.nowPlayingMessage || !this.current) return;
    this.nowPlayingMessage
      .edit({ embeds: [buildNowPlayingEmbed(this)], components: buildControls(this) })
      .catch(() => { this.nowPlayingMessage = null; });
  }

  async clearNowPlaying() {
    const message = this.nowPlayingMessage;
    this.nowPlayingMessage = null;
    if (message) await message.delete().catch(() => {});
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.playToken++;
    this.clearIdleTimer();
    clearTimeout(this.startTimer);
    clearTimeout(this.aloneTimer);
    this.queue = [];
    this.current = null;
    this.stopped = true;
    this.audioPlayer.stop(true);
    this.stream?.kill();
    this.stream = null;
    this.clearNowPlaying();
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      try {
        this.connection.destroy();
      } catch {
        // Already destroyed.
      }
    }
    this.manager.delete(this.guild.id, this);
  }
}
