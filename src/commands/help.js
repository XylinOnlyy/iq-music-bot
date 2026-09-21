import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';

export default {
  data: new SlashCommandBuilder().setName('help').setDescription('Show all commands and how to use them.'),
  async execute(interaction) {
    const idle = Math.round(config.idleTimeoutMs / 60_000);
    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle('🎵 Music Bot - Help')
      .setDescription('Play music from **YouTube** and **Spotify** (tracks, albums, playlists) and download media from **TikTok**, **YouTube** and **Instagram**.')
      .addFields(
        {
          name: '🎶 Music',
          value: [
            '`/join` - Join your voice channel (you must be in one)',
            '`/play <name or link>` - Play a song, YouTube video/playlist, or Spotify track/album/playlist',
            '`/pause` / `/resume` - Pause or resume the music',
            '`/skip` - Skip to the next track',
            '`/stop` - Stop the music and clear the queue',
            '`/leave` - Leave the voice channel',
          ].join('\n'),
        },
        {
          name: '📜 Queue',
          value: [
            '`/queue [page]` - Show the queue',
            '`/nowplaying` - Show the current track and control buttons',
            '`/loop [mode]` - Loop Off, the current Track, or the whole Queue',
            '`/shuffle` - Shuffle the queue',
            '`/remove <position>` - Remove a track from the queue',
            '`/clear` - Clear upcoming tracks',
          ].join('\n'),
        },
        {
          name: '📥 Downloader',
          value: '`/download <link>` - Download a video or photos from TikTok, YouTube or Instagram. Files must fit within this server\'s upload limit.',
        },
        {
          name: '🎛️ Control Buttons',
          value: '⏸️ Pause/Resume • ⏭️ Skip • 🔁 Loop (Off → Track → Queue) • ⏹️ Stop • 🔀 Shuffle • 📜 Queue • 👋 Leave',
        },
        {
          name: 'ℹ️ Good to know',
          value: [
            '• You must be in the same voice channel as the bot to control it.',
            `• When the queue ends (and loop is off), the bot leaves after **${idle} minute(s)** without music.`,
            '• The bot also leaves if everyone else leaves the voice channel.',
            '• Spotify tracks are played by finding the matching song on YouTube.',
          ].join('\n'),
        },
      );
    await interaction.reply({ embeds: [embed] });
  },
};
