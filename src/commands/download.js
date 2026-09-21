import path from 'node:path';
import { AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { download, removeDir } from '../download/downloader.js';
import { uploadLimitBytes } from '../download/platforms.js';
import { UserError } from '../utils/voice.js';

const MAX_FILES_PER_MESSAGE = 10;

function batchFiles(files, limitBytes) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const file of files) {
    if (current.length >= MAX_FILES_PER_MESSAGE || (current.length && size + file.size > limitBytes)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += file.size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export default {
  data: new SlashCommandBuilder()
    .setName('download')
    .setDescription('Download a video or photos from TikTok, YouTube or Instagram.')
    .addStringOption((o) => o.setName('link').setDescription('TikTok, YouTube or Instagram link').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const link = interaction.options.getString('link', true).trim();
    const perms = interaction.appPermissions;
    if (interaction.inGuild() && perms && !perms.has(PermissionFlagsBits.AttachFiles)) {
      throw new UserError("I don't have permission to attach files in this channel.");
    }

    await interaction.deferReply();
    const limitBytes = uploadLimitBytes(interaction.guild);
    const result = await download(link, { userId: interaction.user.id, limitBytes });
    try {
      const content = result.skipped > 0 ? `-# ⚠️ ${result.skipped} item(s) were skipped because they are too large or unavailable.` : '';
      const batches = batchFiles(result.files, limitBytes);
      const toAttachments = (batch) => batch.map((f) => new AttachmentBuilder(f.path, { name: path.basename(f.path) }));
      await interaction.editReply({ content, files: toAttachments(batches[0]) });
      for (const batch of batches.slice(1)) {
        await interaction.followUp({ files: toAttachments(batch) });
      }
    } finally {
      await removeDir(result.dir);
    }
  },
};
