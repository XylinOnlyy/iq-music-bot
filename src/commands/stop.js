import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../music/session.js';
import { simpleEmbed } from '../music/controls.js';
import { config } from '../config.js';

export default {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop the music and clear the queue (the bot stays in the channel).'),
  async execute(interaction, { manager }) {
    const player = requirePlayer(interaction, manager);
    player.stop();
    const minutes = Math.round(config.idleTimeoutMs / 60_000);
    await interaction.reply({ embeds: [simpleEmbed(`⏹️ Stopped the music and cleared the queue. I'll leave in ${minutes} minute(s) if nothing else is played.`)] });
  },
};
