import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { formatDuration, trackLink, truncate, escapeMarkdown } from '../utils/format.js';

export const BUTTON_PREFIX = 'music:';

export const LOOP_LABELS = {
  off: 'Loop: Off',
  track: 'Loop: Track',
  queue: 'Loop: Queue',
};

const LOOP_EMOJI = { off: '➡️', track: '🔂', queue: '🔁' };
const SOURCE_LABEL = { youtube: 'YouTube', spotify: 'Spotify → YouTube' };

export function buildNowPlayingEmbed(player) {
  const track = player.current;
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setAuthor({ name: player.isPaused ? 'Paused' : 'Now Playing' })
    .setDescription(`**${trackLink(track, 200)}**${track.author ? `\n${escapeMarkdown(truncate(track.author, 100))}` : ''}`)
    .addFields(
      { name: 'Duration', value: formatDuration(track.duration), inline: true },
      { name: 'Requested by', value: `<@${track.requester.id}>`, inline: true },
      { name: 'Loop', value: `${LOOP_EMOJI[player.loopMode]} ${LOOP_LABELS[player.loopMode].replace('Loop: ', '')}`, inline: true },
    )
    .setFooter({ text: `${SOURCE_LABEL[track.source] ?? 'YouTube'} • ${player.queue.length} track(s) in queue` });
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

export function buildControls(player, disabled = false) {
  const paused = player.isPaused;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}pause`)
      .setEmoji(paused ? '▶️' : '⏸️')
      .setLabel(paused ? 'Resume' : 'Pause')
      .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}skip`).setEmoji('⏭️').setLabel('Skip').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}loop`)
      .setEmoji(LOOP_EMOJI[player.loopMode])
      .setLabel(LOOP_LABELS[player.loopMode])
      .setStyle(player.loopMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}stop`).setEmoji('⏹️').setLabel('Stop').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}shuffle`).setEmoji('🔀').setLabel('Shuffle').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}queue`).setEmoji('📜').setLabel('Queue').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}leave`).setEmoji('👋').setLabel('Leave').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
  return [row1, row2];
}

export const QUEUE_PAGE_SIZE = 10;

export function buildQueueEmbed(player, page = 1) {
  const totalPages = Math.max(1, Math.ceil(player.queue.length / QUEUE_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * QUEUE_PAGE_SIZE;
  const lines = player.queue
    .slice(start, start + QUEUE_PAGE_SIZE)
    .map((t, i) => `\`${start + i + 1}.\` ${trackLink(t, 60)} \`${formatDuration(t.duration)}\``);

  const totalSeconds = player.queue.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle('Queue')
    .setDescription([
      player.current ? `**Now playing:** ${trackLink(player.current, 80)} \`${formatDuration(player.current.duration)}\`` : '**Nothing is playing.**',
      '',
      lines.length ? lines.join('\n') : '*The queue is empty.*',
    ].join('\n'))
    .setFooter({ text: `Page ${current}/${totalPages} • ${player.queue.length} track(s) • ${formatDuration(totalSeconds)} total • ${LOOP_LABELS[player.loopMode]}` });
  return embed;
}

export function simpleEmbed(description, color = config.embedColor) {
  return new EmbedBuilder().setColor(color).setDescription(description);
}

export const COLORS = {
  success: 0x57f287,
  error: 0xed4245,
  warn: 0xfee75c,
};

export function errorEmbed(description) {
  return simpleEmbed(`❌ ${description}`, COLORS.error);
}

export function successEmbed(description) {
  return simpleEmbed(description, COLORS.success);
}
