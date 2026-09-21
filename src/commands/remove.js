import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../music/session.js';
import { simpleEmbed } from '../music/controls.js';
import { trackLink } from '../utils/format.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue.')
    .addIntegerOption((o) => o.setName('position').setDescription('Position in the queue (see /queue)').setMinValue(1).setRequired(true)),
  async execute(interaction, { manager }) {
    const player = requirePlayer(interaction, manager);
    const removed = player.remove(interaction.options.getInteger('position', true));
    await interaction.reply({ embeds: [simpleEmbed(`🗑️ Removed ${trackLink(removed)} from the queue.`)] });
  },
};
