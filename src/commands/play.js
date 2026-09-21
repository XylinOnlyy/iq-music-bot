import { SlashCommandBuilder } from 'discord.js';
import { joinUserChannel } from '../music/session.js';
import { resolveQuery } from '../music/resolver.js';
import { errorEmbed, successEmbed } from '../music/controls.js';
import { escapeMarkdown, formatDuration, trackLink, truncate } from '../utils/format.js';
import { config } from '../config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist from YouTube or Spotify.')
    .addStringOption((o) => o
      .setName('query')
      .setDescription('Song name, YouTube link, or Spotify track/album/playlist link')
      .setRequired(true)
      .setMaxLength(500)),
  async execute(interaction, { manager }) {
    await interaction.deferReply();
    const query = interaction.options.getString('query', true);
    const { player } = await joinUserChannel(interaction, manager);

    const requester = { id: interaction.user.id, tag: interaction.user.tag };
    let resolved;
    try {
      resolved = await resolveQuery(query, requester);
    } catch (err) {
      if (!player.isActive && !player.destroyed && !player.idleTimer) player.startIdleTimer(false);
      throw err;
    }
    const { tracks, playlist } = resolved;
    if (player.destroyed) {
      await interaction.editReply({ embeds: [errorEmbed('I left the voice channel while loading that. Please try again.')] });
      return;
    }

    const wasIdle = !player.isActive;
    const added = player.enqueue(tracks);
    if (added === 0) {
      await interaction.editReply({ embeds: [errorEmbed(`The queue is full (max ${config.maxQueueSize} tracks).`)] });
      return;
    }

    let description;
    if (playlist) {
      const name = playlist.url ? `[${escapeMarkdown(truncate(playlist.name, 80))}](${playlist.url})` : escapeMarkdown(playlist.name);
      description = `📃 Added **${added}** track(s) from ${name} to the queue.`;
      if (added < tracks.length) description += `\n⚠️ ${tracks.length - added} track(s) were skipped because the queue is full.`;
    } else if (wasIdle) {
      description = `🎶 Starting ${trackLink(tracks[0])} \`${formatDuration(tracks[0].duration)}\``;
    } else {
      description = `➕ Added ${trackLink(tracks[0])} \`${formatDuration(tracks[0].duration)}\` to the queue at position **${player.queue.length}**.`;
    }
    await interaction.editReply({ embeds: [successEmbed(description)] });
    await player.startIfIdle();
  },
};
