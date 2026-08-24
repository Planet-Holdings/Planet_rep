import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, TextChannel, EmbedBuilder } from 'discord.js';
import { botEngine } from './botEngine';
import { db } from './db';

let discordClient: Client | null = null;
let isConnected = false;
let botUserTag = 'TrackerBot#0000';
let guildCount = 0;

export function getDiscordStatus() {
  return {
    isConnected,
    botTag: botUserTag,
    guildCount,
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

export async function initDiscordBot(token?: string) {
  const botToken = token || process.env.DISCORD_BOT_TOKEN;
  if (!botToken || botToken.trim() === '') {
    console.log('[Discord Bot] No DISCORD_BOT_TOKEN provided. Running in high-fidelity Simulator mode.');
    return;
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

      // Clear stale DB state and re-sync live voice snapshot on startup.
      // This prevents "ghost" active members when the bot was offline and missed leave events.
      const targetGuildId = process.env.DISCORD_GUILD_ID;
      const guildsToSync = targetGuildId
        ? c.guilds.cache.filter((g) => g.id === targetGuildId)
        : c.guilds.cache;

      if (targetGuildId && guildsToSync.size === 0) {
        console.warn(`[Discord Bot] DISCORD_GUILD_ID=${targetGuildId} not found in bot guild cache. Skipping startup sync.`);
        return;
      }

      for (const guild of guildsToSync.values()) {
        await db.clearActiveStatesForGuild(guild.id);

        // Voice states cache is the most direct way to identify who is currently connected.
        for (const voiceState of guild.voiceStates.cache.values()) {
          if (!voiceState.channelId) continue;

          const channel =
            voiceState.channel ||
            (await guild.channels.fetch(voiceState.channelId).catch(() => null));
          if (!channel) continue;

          let member = voiceState.member;
          if (!member) {
            member = await guild.members.fetch(voiceState.id).catch(() => null);
          }
          if (!member || member.user.bot) continue;

          const now = Date.now();
          await db.addChannel(channel.id, channel.name);
          await db.setActiveState({
            userId: member.id,
            username: member.user.username,
            userTag: member.user.tag,
            avatarUrl: member.user.displayAvatarURL(),
            channelId: channel.id,
            channelName: channel.name,
            guildId: guild.id,
            isVoice: true,
            isVideo: !!voiceState.selfVideo,
            isStreaming: !!voiceState.streaming,
            selfMute: !!voiceState.selfMute,
            selfDeaf: !!voiceState.selfDeaf,
            voiceStartTime: now,
            videoStartTime: voiceState.selfVideo ? now : null,
            streamStartTime: voiceState.streaming ? now : null,
          });
        }
      }
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

      const userTag = member?.user?.tag || 'unknown#0000';
      const avatarUrl = member?.user ? member.user.displayAvatarURL() : '';
      const guildId = guild.id;
      const guildName = guild.name;

      try {
        await botEngine.handleVoiceStateUpdate(
        {
          userId,
          username,
          userTag,
          avatarUrl,
          guildId,
          guildName,
          channelId: oldState.channelId,
          channelName: oldState.channel?.name,
          selfMute: !!oldState.selfMute,
          selfDeaf: !!oldState.selfDeaf,
          selfVideo: !!oldState.selfVideo,
          streaming: !!oldState.streaming,
        },
        {
          userId,
          username,
          userTag,
          avatarUrl,
          guildId,
          guildName,
          channelId: newState.channelId,
          channelName: newState.channel?.name,
          selfMute: !!newState.selfMute,
          selfDeaf: !!newState.selfDeaf,
          selfVideo: !!newState.selfVideo,
          streaming: !!newState.streaming,
        }
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
