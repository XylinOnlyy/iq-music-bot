import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../music/session.js';
import { simpleEmbed } from '../music/controls.js';

export default {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause the current track.'),
  async execute(interaction, { manager }) {
    requirePlayer(interaction, manager).pause();
    await interaction.reply({ embeds: [simpleEmbed('⏸️ Paused.')] });
  },
};
