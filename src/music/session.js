import { assertCanJoin, getBotVoiceChannel, humanCount, requireSameChannel, requireUserInVoice, UserError } from '../utils/voice.js';

export async function joinUserChannel(interaction, manager) {
  const { guild } = interaction;
  const userChannel = requireUserInVoice(interaction);
  const botChannel = getBotVoiceChannel(guild);
  const existing = manager.get(guild.id);

  if (botChannel && botChannel.id !== userChannel.id && existing?.isActive && humanCount(botChannel) > 0) {
    throw new UserError(`I'm already playing music in ${botChannel}. Join that channel or wait until the music ends.`);
  }

  const alreadyThere = botChannel?.id === userChannel.id && existing && !existing.destroyed;
  assertCanJoin(userChannel);
  const player = manager.getOrCreate(guild);
  player.setTextChannel(interaction.channel);
  await player.connect(userChannel);
  return { player, channel: userChannel, alreadyThere: Boolean(alreadyThere) };
}

export function requirePlayer(interaction, manager) {
  requireSameChannel(interaction);
  const player = manager.get(interaction.guildId);
  if (!player) throw new UserError("I'm not playing anything in this server.");
  return player;
}
