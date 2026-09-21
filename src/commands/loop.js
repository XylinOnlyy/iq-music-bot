import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../music/session.js';
import { simpleEmbed, LOOP_LABELS } from '../music/controls.js';

export default {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the loop mode. Without a mode, it cycles Off → Track → Queue.')
    .addStringOption((o) => o
      .setName('mode')
      .setDescription('Loop mode')
      .addChoices(
        { name: 'Off', value: 'off' },
        { name: 'Track (repeat the current song)', value: 'track' },
        { name: 'Queue (repeat the whole queue/playlist)', value: 'queue' },
      )),
  async execute(interaction, { manager }) {
    const player = requirePlayer(interaction, manager);
    const mode = interaction.options.getString('mode');
    const result = mode ? player.setLoop(mode) : player.cycleLoop();
    await interaction.reply({ embeds: [simpleEmbed(`🔁 ${LOOP_LABELS[result]}`)] });
  },
};
