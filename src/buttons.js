import { MessageFlags } from 'discord.js';
import { BUTTON_PREFIX, buildControls, buildNowPlayingEmbed, buildQueueEmbed, simpleEmbed } from './music/controls.js';
import { requirePlayer } from './music/session.js';
import { trackLink } from './utils/format.js';

export function isMusicButton(interaction) {
  return interaction.isButton() && interaction.customId.startsWith(BUTTON_PREFIX);
}

export async function handleMusicButton(interaction, { manager }) {
  const action = interaction.customId.slice(BUTTON_PREFIX.length);
  const player = requirePlayer(interaction, manager);
  const ephemeral = { flags: MessageFlags.Ephemeral };
  const user = `<@${interaction.user.id}>`;

  // Buttons on an outdated now-playing message should not control the current track.
  if (player.nowPlayingMessage && interaction.message.id !== player.nowPlayingMessage.id) {
    await interaction.update({ components: [] }).catch(() => {});
    await interaction.followUp({ embeds: [simpleEmbed('These controls are outdated. Use `/nowplaying` to get new ones.')], ...ephemeral });
    return;
  }

  switch (action) {
    case 'pause': {
      player.togglePause();
      await interaction.update({ embeds: [buildNowPlayingEmbed(player)], components: buildControls(player) });
      return;
    }
    case 'loop': {
      player.cycleLoop();
      await interaction.update({ embeds: [buildNowPlayingEmbed(player)], components: buildControls(player) });
      return;
    }
    case 'skip': {
      const skipped = player.skip();
      await interaction.reply({ embeds: [simpleEmbed(`⏭️ ${user} skipped ${skipped ? trackLink(skipped) : 'the track'}.`)] });
      return;
    }
    case 'stop': {
      player.stop();
      await interaction.reply({ embeds: [simpleEmbed(`⏹️ ${user} stopped the music and cleared the queue.`)] });
      return;
    }
    case 'shuffle': {
      player.shuffle();
      await interaction.update({ embeds: [buildNowPlayingEmbed(player)], components: buildControls(player) });
      await interaction.followUp({ embeds: [simpleEmbed(`🔀 ${user} shuffled the queue.`)] });
      return;
    }
    case 'queue': {
      await interaction.reply({ embeds: [buildQueueEmbed(player, 1)], ...ephemeral });
      return;
    }
    case 'leave': {
      player.destroy();
      await interaction.reply({ embeds: [simpleEmbed(`👋 ${user} made me leave the voice channel.`)] });
      return;
    }
    default:
      await interaction.reply({ embeds: [simpleEmbed('Unknown action.')], ...ephemeral });
  }
}
