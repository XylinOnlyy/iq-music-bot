import { SlashCommandBuilder } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { getBotVoiceChannel, requireSameChannel, UserError } from '../utils/voice.js';
import { simpleEmbed } from '../music/controls.js';

export default {
  data: new SlashCommandBuilder().setName('leave').setDescription('Make the bot leave the voice channel and clear the queue.'),
  async execute(interaction, { manager }) {
    if (!getBotVoiceChannel(interaction.guild)) throw new UserError("I'm not in a voice channel.");
    const channel = requireSameChannel(interaction);
    const player = manager.get(interaction.guildId);
    if (player) player.destroy();
    else getVoiceConnection(interaction.guildId)?.destroy();
    await interaction.reply({ embeds: [simpleEmbed(`👋 Left ${channel}.`)] });
  },
};
