import { Client, GatewayIntentBits, Events, EmbedBuilder, Guild, VoiceState, TextChannel } from 'discord.js';
import { botEngine, VoiceStateSnapshot } from './botEngine';
import { db } from './db';
import { buildStreamCheck, renderStreamCheckEmbed, nextRunAt, StreamCheckResult } from './streamCheck';

let discordClient: Client | null = null;
let isConnected = false;
let botUserTag = 'TrackerBot#0000';
let guildCount = 0;
let reconcileTimer: NodeJS.Timeout | null = null;
let reconcileRunning = false;
let streamCheckTimer: NodeJS.Timeout | null = null;

// How often tracked state is compared against Discord's live voice cache.
const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS) || 2 * 60 * 1000;
// Daily stream check: what time (office timezone) the bot posts who is live.
const STREAM_CHECK_TIME = process.env.STREAM_CHECK_TIME || '11:00';
const STREAM_CHECK_ENABLED = (process.env.STREAM_CHECK_ENABLED || 'true') !== 'false';
const STREAM_CHECK_WEEKENDS = process.env.STREAM_CHECK_WEEKENDS === 'true';

export function getDiscordStatus() {
  return {
    isConnected,
    botTag: botUserTag,
    guildCount,
    // Used by the dashboard to build discord.com/channels/<guild>/<channel> links.
    guildId: process.env.DISCORD_GUILD_ID || discordClient?.guilds.cache.first()?.id || null,
  };
}

export async function sendReminderDM(userId: string, message: string) {
  if (!discordClient || !isConnected) {
    // Simulator mode: no live bot connection, so there's nothing to actually
    // send. Report that plainly instead of pretending a DM went out.
    return { sent: false, simulated: true, error: 'Bot is not connected (simulator mode) - no DM was actually sent.' };
  }
  try {
    const user = await discordClient.users.fetch(userId);
    await user.send(message);
    return { sent: true, simulated: false };
  } catch (error: any) {
    console.error(`[Discord Bot] Failed to DM ${userId}:`, error);
    return { sent: false, simulated: false, error: error.message || 'Failed to send DM' };
  }
}

function snapshotFromVoiceState(
  vs: VoiceState,
  identity: { userId: string; username: string; userTag: string; avatarUrl: string },
  guild: Guild,
  channelName?: string
): VoiceStateSnapshot {
  return {
    ...identity,
    guildId: guild.id,
    guildName: guild.name,
    channelId: vs.channelId,
    channelName: channelName ?? vs.channel?.name,
    selfMute: !!vs.selfMute,
    selfDeaf: !!vs.selfDeaf,
    selfVideo: !!vs.selfVideo,
    streaming: !!vs.streaming,
  };
}

// Brings the tracked active_states for a guild in line with who is actually in
// voice right now, without wiping anyone's in-progress session:
//  - tracked but no longer in voice  -> synthetic leave (session gets saved)
//  - in voice but not tracked        -> synthetic join
//  - in voice and tracked            -> keep the original start time, but sync
//                                       camera/stream flags if they changed
// Runs at startup, after every gateway resume, and on a timer, so a missed or
// dropped event can never leave a member shown as online for the rest of the day.
async function reconcileGuild(guild: Guild, reason: string) {
  const tracked = (await db.getAllActiveStates()).filter((s) => s.guildId === guild.id);
  const trackedById = new Map(tracked.map((s) => [s.userId, s]));

  const live = new Map<string, VoiceState>();
  for (const vs of guild.voiceStates.cache.values()) {
    if (vs.channelId) live.set(vs.id, vs);
  }

  let fixedGhosts = 0;
  let addedMissing = 0;
  let syncedFlags = 0;

  for (const state of tracked) {
    const vs = live.get(state.userId);
    const identity = { userId: state.userId, username: state.username, userTag: state.userTag, avatarUrl: state.avatarUrl };

    if (!vs) {
      fixedGhosts++;
      console.warn(`[Reconcile:${reason}] ${state.username} is tracked in ${state.channelName} but not in voice — finalizing session`);
      await botEngine.handleVoiceStateUpdate(
        { ...identity, guildId: guild.id, guildName: guild.name, channelId: state.channelId, channelName: state.channelName },
        { ...identity, guildId: guild.id, guildName: guild.name, channelId: null }
      );
      continue;
    }

    const liveChannelId = vs.channelId as string;
    const liveVideo = !!vs.selfVideo;
    const liveStreaming = !!vs.streaming;
    if (liveChannelId !== state.channelId || liveVideo !== state.isVideo || liveStreaming !== state.isStreaming) {
      syncedFlags++;
      const channel = vs.channel || (await guild.channels.fetch(liveChannelId).catch(() => null));
      await botEngine.handleVoiceStateUpdate(
        {
          ...identity,
          guildId: guild.id,
          guildName: guild.name,
          channelId: state.channelId,
          channelName: state.channelName,
          selfVideo: state.isVideo,
          streaming: state.isStreaming,
          selfMute: state.selfMute,
          selfDeaf: state.selfDeaf,
        },
        snapshotFromVoiceState(vs, identity, guild, channel?.name)
      );
    }
  }

  for (const [userId, vs] of live) {
    if (trackedById.has(userId)) continue;
    let member = vs.member;
    if (!member) member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) continue;
    const channel = vs.channel || (await guild.channels.fetch(vs.channelId as string).catch(() => null));
    if (!channel) continue;

    addedMissing++;
    const identity = {
      userId: member.id,
      username: member.user.username,
      userTag: member.user.tag,
      avatarUrl: member.user.displayAvatarURL(),
    };
    await db.addChannel(channel.id, channel.name);
    await botEngine.handleVoiceStateUpdate(
      { ...identity, guildId: guild.id, guildName: guild.name, channelId: null },
      snapshotFromVoiceState(vs, identity, guild, channel.name)
    );
  }

  if (fixedGhosts || addedMissing || syncedFlags || reason !== 'timer') {
    console.log(
      `[Reconcile:${reason}] ${guild.name}: ${live.size} in voice, ${tracked.length} tracked — ` +
        `${fixedGhosts} ghosts closed, ${addedMissing} missing added, ${syncedFlags} flag syncs`
    );
  }
}

async function reconcileAllGuilds(reason: string) {
  if (!discordClient || !isConnected) return;
  if (reconcileRunning) return;
  reconcileRunning = true;
  try {
    const targetGuildId = process.env.DISCORD_GUILD_ID;
    const guilds = targetGuildId
      ? discordClient.guilds.cache.filter((g) => g.id === targetGuildId)
      : discordClient.guilds.cache;

    if (targetGuildId && guilds.size === 0) {
      console.warn(`[Reconcile:${reason}] DISCORD_GUILD_ID=${targetGuildId} not found in bot guild cache. Skipping.`);
      return;
    }
    for (const guild of guilds.values()) {
      await reconcileGuild(guild, reason);
    }
  } catch (error) {
    console.error(`[Reconcile:${reason}] Failed:`, error);
  } finally {
    reconcileRunning = false;
  }
}

// Builds the "who is live right now" summary and optionally posts it to the
// log channel. Returns null when the bot isn't connected, since without the
// gateway there is no live voice state to report.
export async function runStreamCheck(
  reason: string,
  post = true
): Promise<(StreamCheckResult & { posted: boolean; channelId: string | null }) | null> {
  if (!discordClient || !isConnected) return null;

  const guildId = process.env.DISCORD_GUILD_ID || discordClient.guilds.cache.first()?.id;
  const [active, roster] = await Promise.all([db.getAllActiveStates(), db.getRecentRoster()]);
  const result = buildStreamCheck({ active, roster, guildId, now: Date.now() });

  const channelId = process.env.DISCORD_LOG_CHANNEL_ID || null;
  let posted = false;

  if (post && channelId) {
    try {
      const channel = await discordClient.channels.fetch(channelId);
      if (channel && (channel as TextChannel).isTextBased?.()) {
        const e = renderStreamCheckEmbed(result, guildId);
        const embed = new EmbedBuilder()
          .setTitle(e.title)
          .setDescription(e.description)
          .setColor(e.color)
          .setFooter(e.footer)
          .setTimestamp(new Date(e.timestamp));
        e.fields.forEach((f) => embed.addFields({ name: f.name, value: f.value, inline: f.inline }));
        await (channel as TextChannel).send({ embeds: [embed] });
        posted = true;
      } else {
        console.warn(`[StreamCheck] Channel ${channelId} is not a text channel — nothing posted.`);
      }
    } catch (error) {
      console.error('[StreamCheck] Failed to post:', error);
    }
  } else if (post && !channelId) {
    console.warn('[StreamCheck] DISCORD_LOG_CHANNEL_ID is not set — nothing posted.');
  }

  console.log(
    `[StreamCheck:${reason}] ${result.live.length} live, ${result.inVoiceNotLive.length} in voice not live, ` +
      `${result.notOnline.length}/${result.rosterSize} not online — ${posted ? 'posted' : 'not posted'}`
  );
  return { ...result, posted, channelId };
}

function scheduleStreamCheck() {
  if (streamCheckTimer) {
    clearTimeout(streamCheckTimer);
    streamCheckTimer = null;
  }
  if (!STREAM_CHECK_ENABLED) {
    console.log('[StreamCheck] Disabled (STREAM_CHECK_ENABLED=false).');
    return;
  }

  const now = Date.now();
  const next = nextRunAt(now, STREAM_CHECK_TIME, STREAM_CHECK_WEEKENDS);
  const delay = Math.max(1000, next - now);
  console.log(
    `[StreamCheck] Next run at ${new Date(next).toISOString()} ` +
      `(${STREAM_CHECK_TIME} ${process.env.SCHEDULE_TZ || 'America/New_York'}, in ${Math.round(delay / 60000)} min)`
  );

  // setTimeout caps out around 24.8 days; the delay here is always under a day.
  streamCheckTimer = setTimeout(async () => {
    try {
      await runStreamCheck('daily');
    } catch (e) {
      console.error('[StreamCheck] Daily run failed:', e);
    } finally {
      scheduleStreamCheck();
    }
  }, delay);
}

export async function initDiscordBot(token?: string) {
  const botToken = token || process.env.DISCORD_BOT_TOKEN;
  if (!botToken || botToken.trim() === '') {
    console.log('[Discord Bot] No DISCORD_BOT_TOKEN provided. Running in high-fidelity Simulator mode.');
    return;
  }

  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
  if (discordClient) {
    try {
      await discordClient.destroy();
    } catch (e) {
      console.warn('Error destroying existing Discord client:', e);
    }
  }

  try {
    discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    discordClient.once(Events.ClientReady, async (c) => {
      isConnected = true;
      botUserTag = c.user.tag;
      guildCount = c.guilds.cache.size;
      console.log(`[Discord Bot] Logged in as ${c.user.tag}! Monitoring ${guildCount} servers.`);

      // Sync tracked state with the live voice snapshot without discarding
      // sessions that were in progress across the restart.
      await reconcileAllGuilds('startup');

      reconcileTimer = setInterval(() => {
        reconcileAllGuilds('timer');
      }, RECONCILE_INTERVAL_MS);

      scheduleStreamCheck();
    });

    // A resumed gateway session may have dropped events while disconnected.
    discordClient.on(Events.ShardResume, () => {
      console.log('[Discord Bot] Gateway session resumed — reconciling voice states');
      reconcileAllGuilds('resume');
    });
    discordClient.on(Events.ShardDisconnect, (event) => {
      console.warn(`[Discord Bot] Gateway disconnected (code ${event.code})`);
    });
    discordClient.on(Events.Error, (error) => {
      console.error('[Discord Bot] Client error:', error);
    });

    discordClient.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      const guild = newState.guild || oldState.guild;
      const userId = newState.id || oldState.id;

      let member = newState.member || oldState.member;
      if (!member) {
        member = await guild.members.fetch(userId).catch(() => null);
      }

      const isBot = !!member?.user?.bot;
      const username = member?.user?.username || 'unknown';
      const newChannel = newState.channel?.name || 'none';
      const oldChannel = oldState.channel?.name || 'none';

      console.log(`[VoiceStateUpdate] ${username} bot=${isBot} | ${oldChannel} -> ${newChannel}`);

      if (isBot) {
        console.log(`[VoiceStateUpdate] Skipping bot user: ${username}`);
        return;
      }

      const identity = {
        userId,
        username,
        userTag: member?.user?.tag || 'unknown#0000',
        avatarUrl: member?.user ? member.user.displayAvatarURL() : '',
      };

      try {
        await botEngine.handleVoiceStateUpdate(
          snapshotFromVoiceState(oldState, identity, guild),
          snapshotFromVoiceState(newState, identity, guild)
        );
        console.log(`[VoiceStateUpdate] Processed ${username} successfully`);
      } catch (error) {
        console.error(`[VoiceStateUpdate] Error processing ${username}:`, error);
      }

      // Optional: Auto-announce streaming events to a log channel
      const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
      if (logChannelId && !oldState.streaming && newState.streaming && newState.channel) {
        const targetChannel = newState.guild.channels.cache.get(logChannelId);
        if (targetChannel && targetChannel.isTextBased()) {
          const streamerName = member?.user?.username || username;
          targetChannel.send(`🔴 **${streamerName}** started screen sharing in **#${newState.channel.name}**!`);
        }
      }
    });

    discordClient.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const { commandName } = interaction;

      if (commandName === 'stats') {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const timeframe = (interaction.options.getString('timeframe') as any) || 'all';
        const res = await botEngine.executeStatsCommand(targetUser.id, timeframe);
        const embed = res.embeds[0];

        const discordEmbed = new EmbedBuilder()
          .setTitle(embed.title || '')
          .setDescription(embed.description || '')
          .setColor(embed.color || 0x5865F2)
          .setTimestamp(new Date(embed.timestamp || Date.now()));

        if (embed.author) {
          discordEmbed.setAuthor({ name: embed.author.name, iconURL: embed.author.icon_url });
        }
        if (embed.footer) {
          discordEmbed.setFooter({ text: embed.footer.text });
        }
        if (embed.fields) {
          embed.fields.forEach(f => discordEmbed.addFields({ name: f.name, value: f.value, inline: f.inline }));
        }

        await interaction.reply({ embeds: [discordEmbed] });
      } else if (commandName === 'live') {
        const res = await botEngine.executeLiveCommand();
        const embed = res.embeds[0];
        const discordEmbed = new EmbedBuilder()
          .setTitle(embed.title || '')
          .setDescription(embed.description || '')
          .setColor(embed.color || 0x57F287)
          .setTimestamp(new Date());

        embed.fields?.forEach(f => discordEmbed.addFields({ name: f.name, value: f.value, inline: f.inline }));
        await interaction.reply({ embeds: [discordEmbed] });
      } else if (commandName === 'inactive') {
        const days = interaction.options.getInteger('days') || 7;
        const res = await botEngine.executeInactiveCommand(days);
        const embed = res.embeds[0];
        const discordEmbed = new EmbedBuilder()
          .setTitle(embed.title || '')
          .setDescription(embed.description || '')
          .setColor(embed.color || 0xFEE75C)
          .setTimestamp(new Date());

        embed.fields?.forEach(f => discordEmbed.addFields({ name: f.name, value: f.value, inline: f.inline }));
        await interaction.reply({ embeds: [discordEmbed] });
      } else if (commandName === 'leaderboard') {
        const type = (interaction.options.getString('type') as any) || 'stream';
        const timeframe = (interaction.options.getString('timeframe') as any) || 'weekly';
        const res = await botEngine.executeLeaderboardCommand(type, timeframe);
        const embed = res.embeds[0];
        const discordEmbed = new EmbedBuilder()
          .setTitle(embed.title || '')
          .setDescription(embed.description || '')
          .setColor(embed.color || 0xEB459E)
          .setTimestamp(new Date());

        embed.fields?.forEach(f => discordEmbed.addFields({ name: f.name, value: f.value, inline: f.inline }));
        await interaction.reply({ embeds: [discordEmbed] });
      }
    });

    await discordClient.login(botToken);
  } catch (error) {
    console.error('[Discord Bot] Connection error:', error);
    isConnected = false;
  }
}
