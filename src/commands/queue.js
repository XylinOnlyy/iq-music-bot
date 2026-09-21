import { SlashCommandBuilder } from 'discord.js';
import { buildQueueEmbed } from '../music/controls.js';
import { UserError } from '../utils/voice.js';

export default {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the music queue.')
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),
  async execute(interaction, { manager }) {
    const player = manager.get(interaction.guildId);
    if (!player || (!player.current && !player.queue.length)) throw new UserError('The queue is empty.');
    await interaction.reply({ embeds: [buildQueueEmbed(player, interaction.options.getInteger('page') ?? 1)] });
  },
};
