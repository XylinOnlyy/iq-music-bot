import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../music/session.js';
import { simpleEmbed } from '../music/controls.js';

export default {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue.'),
  async execute(interaction, { manager }) {
    const player = requirePlayer(interaction, manager);
    player.shuffle();
    await interaction.reply({ embeds: [simpleEmbed(`🔀 Shuffled ${player.queue.length} tracks.`)] });
  },
};
