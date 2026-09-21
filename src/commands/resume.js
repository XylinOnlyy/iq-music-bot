import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../music/session.js';
import { simpleEmbed } from '../music/controls.js';

export default {
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume the paused track.'),
  async execute(interaction, { manager }) {
    requirePlayer(interaction, manager).resume();
    await interaction.reply({ embeds: [simpleEmbed('▶️ Resumed.')] });
  },
};
