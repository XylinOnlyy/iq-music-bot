import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../music/session.js';
import { simpleEmbed } from '../music/controls.js';
import { UserError } from '../utils/voice.js';

export default {
  data: new SlashCommandBuilder().setName('clear').setDescription('Clear the upcoming tracks (the current song keeps playing).'),
  async execute(interaction, { manager }) {
    const player = requirePlayer(interaction, manager);
    if (!player.queue.length) throw new UserError('The queue is already empty.');
    const count = player.clearQueue();
    await interaction.reply({ embeds: [simpleEmbed(`🧹 Removed ${count} track(s) from the queue.`)] });
  },
};
