import { SlashCommandBuilder } from 'discord.js';
import { simpleEmbed } from '../music/controls.js';
import { UserError } from '../utils/voice.js';

export default {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current track with the control buttons.'),
  async execute(interaction, { manager }) {
    const player = manager.get(interaction.guildId);
    if (!player?.current || player.loading) throw new UserError('Nothing is playing right now.');
    player.setTextChannel(interaction.channel);
    await interaction.reply({ embeds: [simpleEmbed('🎵 Here are the player controls:')] });
    await player.sendNowPlaying();
  },
};
