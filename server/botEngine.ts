import { db } from './db';
import {
  ActiveMemberState,
  MemberSession,
  ActivityType,
  AlertLogItem,
  SlashCommandResponse,
  DiscordEmbed
} from '../src/types';

export interface VoiceStateSnapshot {
  userId: string;
  username: string;
  userTag: string;
  avatarUrl?: string;
  guildId: string;
  guildName?: string;
  channelId: string | null;
  channelName?: string;
  selfMute?: boolean;
  selfDeaf?: boolean;
  selfVideo?: boolean;
  streaming?: boolean;
  streamTitle?: string;
}

export class BotEngine {
  private autoAlertStream = true;
  private autoAlertVideo = true;

  // Voice-state updates for the same user must be processed strictly in order.
  // Discord can deliver a join and a leave milliseconds apart (connection
  // flaps); if both handlers run concurrently, the leave reads "no active
  // state" before the join has written one, does nothing, and the join then
  // leaves a ghost row behind that shows the member as online forever.
  private userQueues = new Map<string, Promise<void>>();

  public handleVoiceStateUpdate(oldState: VoiceStateSnapshot, newState: VoiceStateSnapshot): Promise<void> {
    const userId = newState.userId || oldState.userId;
    const previous = this.userQueues.get(userId) || Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => this.processVoiceStateUpdate(oldState, newState));
    this.userQueues.set(userId, run);
    run.finally(() => {
      if (this.userQueues.get(userId) === run) this.userQueues.delete(userId);
    }).catch(() => undefined);
    return run;
  }

  // Format seconds to human string (e.g., "2h 15m 30s")
  public formatDuration(totalSeconds: number): string {
    if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
  }

  // Core Voice State Handler (Used by both Discord Gateway and Simulator).
  // Always invoked through handleVoiceStateUpdate's per-user queue.
  private async processVoiceStateUpdate(
    oldState: VoiceStateSnapshot,
    newState: VoiceStateSnapshot
  ) {
    const now = Date.now();
    const userId = newState.userId || oldState.userId;
    const username = newState.username || oldState.username;
    const userTag = newState.userTag || oldState.userTag;
    const avatarUrl = newState.avatarUrl || oldState.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=128&h=128&fit=crop&crop=faces';
    const guildId = newState.guildId || oldState.guildId || 'guild-main';
    const guildName = newState.guildName || oldState.guildName || 'Discord Server';

    await db.upsertMember({ userId, username, userTag, avatarUrl });

    const currentActive = await db.getActiveState(userId);

    // CASE 1: USER LEFT VOICE COMPLETELY
    if (oldState.channelId && !newState.channelId) {
      if (currentActive) {
        // Finalize voice
        if (currentActive.isVoice && currentActive.voiceStartTime) {
          const dur = Math.max(1, Math.floor((now - currentActive.voiceStartTime) / 1000));
          await db.addCompletedSession({
            id: `sess-${userId}-v-${now}`,
            userId,
            username,
            userTag,
            avatarUrl,
            guildId,
            guildName,
            channelId: currentActive.channelId,
            channelName: currentActive.channelName,
            activityType: 'voice',
            startTime: currentActive.voiceStartTime,
            endTime: now,
            durationSeconds: dur,
            isOngoing: false,
          });
        }
        // Finalize video if active
        if (currentActive.isVideo && currentActive.videoStartTime) {
          const dur = Math.max(1, Math.floor((now - currentActive.videoStartTime) / 1000));
          await db.addCompletedSession({
            id: `sess-${userId}-vid-${now}`,
            userId,
            username,
            userTag,
            avatarUrl,
            guildId,
            guildName,
            channelId: currentActive.channelId,
            channelName: currentActive.channelName,
            activityType: 'video',
            startTime: currentActive.videoStartTime,
            endTime: now,
            durationSeconds: dur,
            isOngoing: false,
          });
        }
        // Finalize stream if active
        if (currentActive.isStreaming && currentActive.streamStartTime) {
          const dur = Math.max(1, Math.floor((now - currentActive.streamStartTime) / 1000));
          await db.addCompletedSession({
            id: `sess-${userId}-str-${now}`,
            userId,
            username,
            userTag,
            avatarUrl,
            guildId,
            guildName,
            channelId: currentActive.channelId,
            channelName: currentActive.channelName,
            activityType: 'stream',
            startTime: currentActive.streamStartTime,
            endTime: now,
            durationSeconds: dur,
            isOngoing: false,
            metadata: { streamTitle: currentActive.streamTitle }
          });
        }

        const sessionDuration = currentActive.voiceStartTime
          ? this.formatDuration((now - currentActive.voiceStartTime) / 1000)
          : undefined;

        await db.addAlertLog({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: now,
          type: 'voice_leave',
          userId,
          username,
          userTag,
          avatarUrl,
          channelName: currentActive.channelName,
          message: `🚪 ${username} left voice channel ${currentActive.channelName} (Session: ${sessionDuration || '0s'})`,
          durationFormatted: sessionDuration,
        });

      }
      // Always clear the row, even when no active state was found, so a leave
      // can never leave a stale "online" entry behind.
      await db.removeActiveState(userId);
      return;
    }

    // CASE 2: USER JOINED VOICE A FRESH CHANNEL
    if (!oldState.channelId && newState.channelId) {
      const channelName = newState.channelName || 'Voice Channel';
      const isVideo = !!newState.selfVideo;
      const isStreaming = !!newState.streaming;

      await db.addChannel(newState.channelId, channelName);

      const activeState: ActiveMemberState = {
        userId,
        username,
        userTag,
        avatarUrl,
        channelId: newState.channelId,
        channelName,
        guildId,
        isVoice: true,
        isVideo,
        isStreaming,
        selfMute: !!newState.selfMute,
        selfDeaf: !!newState.selfDeaf,
        voiceStartTime: now,
        videoStartTime: isVideo ? now : null,
        streamStartTime: isStreaming ? now : null,
        streamTitle: newState.streamTitle,
      };

      await db.setActiveState(activeState);

      await db.addAlertLog({
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: now,
        type: 'voice_join',
        userId,
        username,
        userTag,
        avatarUrl,
        channelName,
        message: `🔊 ${username} joined voice channel ${channelName}`,
      });

      if (isStreaming) {
        await db.addAlertLog({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: now,
          type: 'stream_start',
          userId,
          username,
          userTag,
          avatarUrl,
          channelName,
          message: `🔴 ${username} is LIVE streaming screen in ${channelName}`,
        });
      }

      if (isVideo) {
        await db.addAlertLog({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: now,
          type: 'video_start',
          userId,
          username,
          userTag,
          avatarUrl,
          channelName,
          message: `📹 ${username} turned on camera in ${channelName}`,
        });
      }
      return;
    }

    // CASE 3: USER SWITCHED CHANNELS
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      const oldChannelName = currentActive?.channelName || oldState.channelName || 'Voice Channel';
      const newChannelName = newState.channelName || 'New Voice Channel';

      await db.addChannel(newState.channelId, newChannelName);

      if (currentActive) {
        // Finalize old voice session
        if (currentActive.voiceStartTime) {
          const dur = Math.max(1, Math.floor((now - currentActive.voiceStartTime) / 1000));
          await db.addCompletedSession({
            id: `sess-${userId}-v-${now}`,
            userId,
            username,
            userTag,
            avatarUrl,
            guildId,
            guildName,
            channelId: currentActive.channelId,
            channelName: currentActive.channelName,
            activityType: 'voice',
            startTime: currentActive.voiceStartTime,
            endTime: now,
            durationSeconds: dur,
            isOngoing: false,
          });
        }
        // Finalize video if active
        if (currentActive.isVideo && currentActive.videoStartTime) {
          const dur = Math.max(1, Math.floor((now - currentActive.videoStartTime) / 1000));
          await db.addCompletedSession({
            id: `sess-${userId}-vid-${now}`,
            userId,
            username,
            userTag,
            avatarUrl,
            guildId,
            guildName,
            channelId: currentActive.channelId,
            channelName: currentActive.channelName,
            activityType: 'video',
            startTime: currentActive.videoStartTime,
            endTime: now,
            durationSeconds: dur,
            isOngoing: false,
          });
        }
        // Finalize stream if active
        if (currentActive.isStreaming && currentActive.streamStartTime) {
          const dur = Math.max(1, Math.floor((now - currentActive.streamStartTime) / 1000));
          await db.addCompletedSession({
            id: `sess-${userId}-str-${now}`,
            userId,
            username,
            userTag,
            avatarUrl,
            guildId,
            guildName,
            channelId: currentActive.channelId,
            channelName: currentActive.channelName,
            activityType: 'stream',
            startTime: currentActive.streamStartTime,
            endTime: now,
            durationSeconds: dur,
            isOngoing: false,
          });
        }
      }

      const isVideo = newState.selfVideo !== undefined ? !!newState.selfVideo : !!currentActive?.isVideo;
      const isStreaming = newState.streaming !== undefined ? !!newState.streaming : !!currentActive?.isStreaming;

      const updatedState: ActiveMemberState = {
        userId,
        username,
        userTag,
        avatarUrl,
        channelId: newState.channelId,
        channelName: newChannelName,
        guildId,
        isVoice: true,
        isVideo,
        isStreaming,
        selfMute: !!newState.selfMute,
        selfDeaf: !!newState.selfDeaf,
        voiceStartTime: now,
        videoStartTime: isVideo ? now : null,
        streamStartTime: isStreaming ? now : null,
        streamTitle: newState.streamTitle || currentActive?.streamTitle,
      };

      await db.setActiveState(updatedState);

      await db.addAlertLog({
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: now,
        type: 'channel_switch',
        userId,
        username,
        userTag,
        avatarUrl,
        channelName: newChannelName,
        message: `🔄 ${username} switched from ${oldChannelName} ➔ ${newChannelName}`,
      });
      return;
    }

    // CASE 4: IN-CHANNEL STATE MUTATIONS (Camera on/off, Stream on/off, Mute/Deaf)
    if (oldState.channelId && newState.channelId && oldState.channelId === newState.channelId && currentActive) {
      const channelName = currentActive.channelName;
      let stateChanged = false;

      // Check Camera (Video) Toggle
      const oldVid = !!oldState.selfVideo || !!currentActive.isVideo;
      const newVid = newState.selfVideo !== undefined ? !!newState.selfVideo : oldVid;

      if (!oldVid && newVid) {
        // Camera turned ON
        currentActive.isVideo = true;
        currentActive.videoStartTime = now;
        stateChanged = true;

        await db.addAlertLog({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: now,
          type: 'video_start',
          userId,
          username,
          userTag,
          avatarUrl,
          channelName,
          message: `📹 ${username} turned on camera in ${channelName}`,
        });
      } else if (oldVid && !newVid && currentActive.videoStartTime) {
        // Camera turned OFF
        const dur = Math.max(1, Math.floor((now - currentActive.videoStartTime) / 1000));
        await db.addCompletedSession({
          id: `sess-${userId}-vid-${now}`,
          userId,
          username,
          userTag,
          avatarUrl,
          guildId,
          guildName,
          channelId: currentActive.channelId,
          channelName: currentActive.channelName,
          activityType: 'video',
          startTime: currentActive.videoStartTime,
          endTime: now,
          durationSeconds: dur,
          isOngoing: false,
        });

        currentActive.isVideo = false;
        currentActive.videoStartTime = null;
        stateChanged = true;

        await db.addAlertLog({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: now,
          type: 'video_stop',
          userId,
          username,
          userTag,
          avatarUrl,
          channelName,
          message: `📹 ${username} stopped video camera in ${channelName} (${this.formatDuration(dur)})`,
          durationFormatted: this.formatDuration(dur),
        });
      }

      // Check Screen Share (Streaming) Toggle
      const oldStr = !!oldState.streaming || !!currentActive.isStreaming;
      const newStr = newState.streaming !== undefined ? !!newState.streaming : oldStr;

      if (!oldStr && newStr) {
        // Screen share started
        currentActive.isStreaming = true;
        currentActive.streamStartTime = now;
        if (newState.streamTitle) currentActive.streamTitle = newState.streamTitle;
        stateChanged = true;

        await db.addAlertLog({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: now,
          type: 'stream_start',
          userId,
          username,
          userTag,
          avatarUrl,
          channelName,
          message: `🔴 ${username} started streaming screen in ${channelName}`,
        });
      } else if (oldStr && !newStr && currentActive.streamStartTime) {
        // Screen share stopped
        const dur = Math.max(1, Math.floor((now - currentActive.streamStartTime) / 1000));
        await db.addCompletedSession({
          id: `sess-${userId}-str-${now}`,
          userId,
          username,
          userTag,
          avatarUrl,
          guildId,
          guildName,
          channelId: currentActive.channelId,
          channelName: currentActive.channelName,
          activityType: 'stream',
          startTime: currentActive.streamStartTime,
          endTime: now,
          durationSeconds: dur,
          isOngoing: false,
          metadata: { streamTitle: currentActive.streamTitle }
        });

        currentActive.isStreaming = false;
        currentActive.streamStartTime = null;
        stateChanged = true;

        await db.addAlertLog({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: now,
          type: 'stream_stop',
          userId,
          username,
          userTag,
          avatarUrl,
          channelName,
          message: `🔴 ${username} stopped streaming screen in ${channelName} (${this.formatDuration(dur)})`,
          durationFormatted: this.formatDuration(dur),
        });
      }

      if (newState.selfMute !== undefined) currentActive.selfMute = !!newState.selfMute;
      if (newState.selfDeaf !== undefined) currentActive.selfDeaf = !!newState.selfDeaf;

      await db.setActiveState(currentActive);
    }
  }

  // --- Slash Command Handlers & Embed Formatter ---

  // /stats @user [timeframe: daily | weekly | monthly | all]
  public async executeStatsCommand(userId: string, timeframe: 'all' | 'daily' | 'weekly' | 'monthly' = 'all'): Promise<SlashCommandResponse> {
    const stats = await db.getUserStats(userId, timeframe);
    const timeLabel = timeframe === 'daily' ? 'Last 24 Hours' : timeframe === 'weekly' ? 'Last 7 Days' : timeframe === 'monthly' ? 'Last 30 Days' : 'All Time';

    const voiceFormatted = this.formatDuration(stats.totalVoiceSeconds);
    const videoFormatted = this.formatDuration(stats.totalVideoSeconds);
    const streamFormatted = this.formatDuration(stats.totalStreamSeconds);
    const totalFormatted = this.formatDuration(stats.totalSeconds);

    // Calculate percentage breakdown for visual bar
    const totalSec = Math.max(1, stats.totalSeconds);
    const vPct = Math.round((stats.totalVoiceSeconds / totalSec) * 100);
    const vidPct = Math.round((stats.totalVideoSeconds / totalSec) * 100);
    const strPct = Math.round((stats.totalStreamSeconds / totalSec) * 100);

    const embed: DiscordEmbed = {
      title: `📊 Activity Stats for ${stats.user.username}`,
      description: `Detailed voice, video, and screen-sharing breakdown (${timeLabel}).\nStatus: **${stats.isCurrentlyActive ? `🟢 Active in ${stats.currentChannel}` : '⚪ Offline'}**`,
      color: 0x5865F2, // Discord Blurple
      author: {
        name: stats.user.userTag,
        icon_url: stats.user.avatarUrl,
      },
      fields: [
        {
          name: '🔊 Voice Time',
          value: `**${voiceFormatted}** (${vPct}%)`,
          inline: true,
        },
        {
          name: '📹 Video Call Time',
          value: `**${videoFormatted}** (${vidPct}%)`,
          inline: true,
        },
        {
          name: '🔴 Screen Share / Stream',
          value: `**${streamFormatted}** (${strPct}%)`,
          inline: true,
        },
        {
          name: '📈 Total Tracked Time',
          value: `**${totalFormatted}** across ${stats.sessionCount} logged sessions`,
          inline: false,
        },
        {
          name: '⏱️ Activity Distribution',
          value: `\`[Voice: ${vPct}% | Video: ${vidPct}% | Stream: ${strPct}%]\``,
          inline: false,
        }
      ],
      footer: {
        text: `Discord Voice & Stream Tracker • ID: ${userId}`,
      },
      timestamp: new Date().toISOString(),
    };

    return {
      command: `/stats @${stats.user.username} timeframe:${timeframe}`,
      executedAt: Date.now(),
      embeds: [embed],
    };
  }

  // /live
  public async executeLiveCommand(): Promise<SlashCommandResponse> {
    const activeMembers = await db.getAllActiveStates();
    const now = Date.now();

    const streamingMembers = activeMembers.filter(m => m.isStreaming);
    const videoMembers = activeMembers.filter(m => m.isVideo);
    const voiceOnlyMembers = activeMembers.filter(m => !m.isVideo && !m.isStreaming);

    const formatList = (list: ActiveMemberState[], type: 'stream' | 'video' | 'voice') => {
      if (list.length === 0) return '*None active*';
      return list
        .map(m => {
          let startTime = m.voiceStartTime;
          if (type === 'stream' && m.streamStartTime) startTime = m.streamStartTime;
          if (type === 'video' && m.videoStartTime) startTime = m.videoStartTime;
          const dur = this.formatDuration((now - startTime) / 1000);
          const extra = m.streamTitle ? `\n  └ *"${m.streamTitle}"*` : '';
          return `• **${m.username}** in \`${m.channelName}\` (⏱️ ${dur})${extra}`;
        })
        .join('\n');
    };

    const embed: DiscordEmbed = {
      title: `🔴 Currently Active Members (${activeMembers.length} Total)`,
      description: `Real-time breakdown of all users in voice channels right now.`,
      color: activeMembers.length > 0 ? 0x57F287 : 0xED4245, // Green or Red
      fields: [
        {
          name: `🔴 Screen Sharing / Live Streams (${streamingMembers.length})`,
          value: formatList(streamingMembers, 'stream'),
          inline: false,
        },
        {
          name: `📹 Video Cameras Turned On (${videoMembers.length})`,
          value: formatList(videoMembers, 'video'),
          inline: false,
        },
        {
          name: `🔊 Voice-Only Connected (${voiceOnlyMembers.length})`,
          value: formatList(voiceOnlyMembers, 'voice'),
          inline: false,
        },
      ],
      footer: {
        text: `Live status as of ${new Date().toLocaleTimeString()}`,
      },
      timestamp: new Date().toISOString(),
    };

    return {
      command: '/live',
      executedAt: Date.now(),
      embeds: [embed],
    };
  }

  // /inactive [days: 7]
  public async executeInactiveCommand(daysThreshold = 7): Promise<SlashCommandResponse> {
    const report = await db.getInactiveMembers(daysThreshold);

    const memberLines = report.inactiveMembers.slice(0, 15).map(m => {
      const lastSeenStr = m.daysSinceLastActive > 90 ? 'Never in voice' : `${m.daysSinceLastActive} days ago`;
      return `• **${m.username}** (\`${m.userTag}\`) — Last active: *${lastSeenStr}*`;
    });

    const displayList = memberLines.length > 0
      ? memberLines.join('\n') + (report.inactiveCount > 15 ? `\n*...and ${report.inactiveCount - 15} more members.*` : '')
      : '🎉 No inactive members found! Everyone has been active in voice recently.';

    const embed: DiscordEmbed = {
      title: `💤 Inactive Voice Members (No activity in ${daysThreshold}+ days)`,
      description: `Found **${report.inactiveCount}** out of **${report.totalGuildMembers}** members with no voice/video/stream activity in the last **${daysThreshold} days**.`,
      color: 0xFEE75C, // Warning Yellow
      fields: [
        {
          name: 'Inactive Member List',
          value: displayList,
          inline: false,
        }
      ],
      footer: {
        text: `Use /inactive [days] to adjust threshold window.`,
      },
      timestamp: new Date().toISOString(),
    };

    return {
      command: `/inactive days:${daysThreshold}`,
      executedAt: Date.now(),
      embeds: [embed],
    };
  }

  // /leaderboard [type: stream | video | voice | all] [timeframe: weekly | monthly | all]
  public async executeLeaderboardCommand(
    activityType: ActivityType | 'all' = 'stream',
    timeframe: 'daily' | 'weekly' | 'monthly' | 'all' = 'weekly'
  ): Promise<SlashCommandResponse> {
    const leaderboard = await db.getLeaderboard(activityType, timeframe);
    const typeLabel = activityType === 'stream' ? 'Screen Sharing / Streaming' : activityType === 'video' ? 'Video Calls' : activityType === 'voice' ? 'Voice Channels' : 'Total Voice/Video/Stream';
    const timeLabel = timeframe === 'daily' ? 'Today' : timeframe === 'weekly' ? 'This Week' : timeframe === 'monthly' ? 'This Month' : 'All Time';

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    const topEntries = leaderboard.slice(0, 10).map((entry, idx) => {
      const medal = medals[idx] || `\`#${idx + 1}\``;
      const formatted = this.formatDuration(entry.score);
      const hours = (entry.score / 3600).toFixed(1);
      return `${medal} **${entry.user.username}** — **${formatted}** (${hours}h) • *${entry.sessionCount} sessions*`;
    });

    const embed: DiscordEmbed = {
      title: `🏆 ${typeLabel} Leaderboard (${timeLabel})`,
      description: `Top active server members ranked by cumulative time spent in **${typeLabel.toLowerCase()}**.`,
      color: 0xEB459E, // Fuchsia/Pink
      fields: [
        {
          name: 'Rankings',
          value: topEntries.length > 0 ? topEntries.join('\n') : '*No activity recorded for this period yet.*',
          inline: false,
        }
      ],
      footer: {
        text: `Updated automatically • Discord Voice Tracker`,
      },
      timestamp: new Date().toISOString(),
    };

    return {
      command: `/leaderboard type:${activityType} timeframe:${timeframe}`,
      executedAt: Date.now(),
      embeds: [embed],
    };
  }
}

export const botEngine = new BotEngine();
