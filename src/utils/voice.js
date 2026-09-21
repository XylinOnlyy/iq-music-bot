import { ChannelType, PermissionFlagsBits } from 'discord.js';

export class UserError extends Error {}

export function getMemberVoiceChannel(interaction) {
  return interaction.member?.voice?.channel ?? null;
}

export function getBotVoiceChannel(guild) {
  return guild.members.me?.voice?.channel ?? null;
}

export function humanCount(channel) {
  return channel.members.filter((m) => !m.user.bot).size;
}

export function assertCanJoin(channel) {
  const me = channel.guild.members.me;
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.Connect)) {
    throw new UserError(`I don't have permission to join ${channel}.`);
  }
  if (!perms.has(PermissionFlagsBits.Speak)) {
    throw new UserError(`I don't have permission to speak in ${channel}.`);
  }
  if (channel.full && !perms.has(PermissionFlagsBits.MoveMembers) && me.voice.channelId !== channel.id) {
    throw new UserError(`${channel} is full.`);
  }
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    throw new UserError('That is not a voice channel.');
  }
}

export function requireUserInVoice(interaction) {
  const channel = getMemberVoiceChannel(interaction);
  if (!channel) throw new UserError('You need to join a voice channel first.');
  return channel;
}

export function requireSameChannel(interaction) {
  const userChannel = requireUserInVoice(interaction);
  const botChannel = getBotVoiceChannel(interaction.guild);
  if (!botChannel) throw new UserError("I'm not in a voice channel.");
  if (botChannel.id !== userChannel.id) throw new UserError(`You need to be in ${botChannel} to do that.`);
  return botChannel;
}
