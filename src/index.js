import { ActivityType, Client, Events, GatewayIntentBits, InteractionContextType, MessageFlags } from 'discord.js';
import { config, validateConfig } from './config.js';
import { commands } from './commands/index.js';
import { handleMusicButton, isMusicButton } from './buttons.js';
import { PlayerManager } from './music/PlayerManager.js';
import { ResolveError } from './music/resolver.js';
import { DownloadError } from './download/downloader.js';
import { errorEmbed } from './music/controls.js';
import { UserError } from './utils/voice.js';
import { logger } from './utils/logger.js';
import { ensureYtDlp } from './utils/ytdlp.js';

const problems = validateConfig();
if (problems.length) {
  for (const problem of problems) logger.error(problem);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const manager = new PlayerManager(client);
const context = { manager };

function isExpectedError(err) {
  return err instanceof UserError || err instanceof ResolveError || err instanceof DownloadError;
}

async function replyError(interaction, message) {
  const payload = { embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ embeds: payload.embeds, files: [], components: [] });
    } else if (interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    logger.debug('Could not send error reply:', err.message);
  }
}

client.once(Events.ClientReady, async (ready) => {
  logger.info(`Logged in as ${ready.user.tag} (${ready.guilds.cache.size} server(s)).`);
  ready.user.setActivity('/help', { type: ActivityType.Listening });

  const body = [...commands.values()].map((c) => c.data.setContexts(InteractionContextType.Guild).toJSON());
  try {
    if (config.guildId) {
      const guild = await ready.guilds.fetch(config.guildId);
      await guild.commands.set(body);
      logger.info(`Registered ${body.length} commands in guild ${guild.name}.`);
    } else {
      await ready.application.commands.set(body);
      logger.info(`Registered ${body.length} global commands.`);
    }
  } catch (err) {
    logger.error('Failed to register slash commands:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inCachedGuild()) {
    if (interaction.isRepliable()) await replyError(interaction, 'This bot can only be used in a server.');
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return replyError(interaction, 'Unknown command.');
      await command.execute(interaction, context);
    } else if (isMusicButton(interaction)) {
      await handleMusicButton(interaction, context);
    }
  } catch (err) {
    if (isExpectedError(err)) {
      await replyError(interaction, err.message);
    } else {
      logger.error(`Error handling ${interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.customId ?? 'interaction'}:`, err);
      await replyError(interaction, 'Something went wrong. Please try again.');
    }
  }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  try {
    manager.handleVoiceStateUpdate(oldState, newState);
  } catch (err) {
    logger.error('Voice state handler failed:', err);
  }
});

client.on(Events.GuildDelete, (guild) => manager.get(guild.id)?.destroy());
client.on(Events.Error, (err) => logger.error('Client error:', err));
client.on(Events.Warn, (msg) => logger.warn('Client warning:', msg));

process.on('unhandledRejection', (err) => logger.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => logger.error('Uncaught exception:', err));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down...`);
  manager.destroyAll();
  await client.destroy().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await ensureYtDlp();
} catch (err) {
  logger.error('Could not set up yt-dlp:', err.message);
  process.exit(1);
}
await client.login(config.token);
