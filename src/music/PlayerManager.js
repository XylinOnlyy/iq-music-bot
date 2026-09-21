import { GuildPlayer } from './GuildPlayer.js';

export class PlayerManager {
  constructor(client) {
    this.client = client;
    this.players = new Map();
  }

  get(guildId) {
    return this.players.get(guildId) ?? null;
  }

  getOrCreate(guild) {
    let player = this.players.get(guild.id);
    if (!player || player.destroyed) {
      player = new GuildPlayer(this, guild);
      this.players.set(guild.id, player);
    }
    return player;
  }

  delete(guildId, player) {
    if (this.players.get(guildId) === player) this.players.delete(guildId);
  }

  handleVoiceStateUpdate(oldState, newState) {
    const guildId = newState.guild.id;
    const player = this.players.get(guildId);
    if (!player) return;

    if (newState.id === this.client.user.id && !newState.channelId) {
      player.destroy();
      return;
    }
    if (newState.id === this.client.user.id) {
      // Wait a tick so the voice connection has the new channel id if we were moved.
      setImmediate(() => player.checkAlone());
    } else if (oldState.channelId === player.channelId || newState.channelId === player.channelId) {
      player.checkAlone();
    }
  }

  destroyAll() {
    for (const player of [...this.players.values()]) player.destroy();
  }
}
