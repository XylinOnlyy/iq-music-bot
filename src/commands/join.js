import { SlashCommandBuilder } from 'discord.js';
import { joinUserChannel } from '../music/session.js';
import { successEmbed, simpleEmbed } from '../music/controls.js';

export default {
  data: new SlashCommandBuilder().setName('join').setDescription('Make the bot join your voice channel.'),
  async execute(interaction, { manager }) {
    await interaction.deferReply();
    const { player, channel, alreadyThere } = await joinUserChannel(interaction, manager);
    if (alreadyThere) {
      await interaction.editReply({ embeds: [simpleEmbed(`I'm already in ${channel}.`)] });
      return;
    }
    if (!player.isActive) player.startIdleTimer(false);
    await interaction.editReply({ embeds: [successEmbed(`✅ Joined ${channel}. Use \`/play\` to start the music.`)] });
  },
};
