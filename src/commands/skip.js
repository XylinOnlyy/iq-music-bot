import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../music/session.js';
import { simpleEmbed } from '../music/controls.js';
import { trackLink } from '../utils/format.js';

export default {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track.'),
  async execute(interaction, { manager }) {
    const player = requirePlayer(interaction, manager);
    const skipped = player.skip();
    await interaction.reply({ embeds: [simpleEmbed(`⏭️ Skipped ${skipped ? trackLink(skipped) : 'the current track'}.`)] });
  },
};
