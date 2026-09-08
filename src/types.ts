export type ActivityType = 'voice' | 'video' | 'stream';

export interface MemberSession {
  id: string;
  userId: string;
  username: string;
  userTag: string;
  avatarUrl: string;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  activityType: ActivityType;
  startTime: number; // Unix timestamp ms
  endTime?: number | null; // Unix timestamp ms (null if ongoing)
  durationSeconds: number;
  isOngoing: boolean;
  metadata?: {
    selfMute?: boolean;
    selfDeaf?: boolean;
    streamTitle?: string;
  };
}

export interface ActiveMemberState {
  userId: string;
  username: string;
  userTag: string;
  avatarUrl: string;
  channelId: string;
  channelName: string;
  guildId: string;
  isVoice: boolean;
  isVideo: boolean;
  isStreaming: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  voiceStartTime: number;
  videoStartTime?: number | null;
  streamStartTime?: number | null;
  streamTitle?: string;
}

export interface GuildMemberSummary {
  userId: string;
  username: string;
  userTag: string;
  avatarUrl: string;
  totalVoiceSeconds: number;
  totalVideoSeconds: number;
  totalStreamSeconds: number;
  totalSessions: number;
  lastActiveTimestamp: number;
  isCurrentlyActive: boolean;
  currentChannelName?: string;
  currentActivities?: ActivityType[];
  daysSinceLastActive: number;
}

export interface VoiceChannelData {
  id: string;
  name: string;
  userLimit?: number;
  members: ActiveMemberState[];
}

export interface AlertLogItem {
  id: string;
  timestamp: number;
  type: 'voice_join' | 'voice_leave' | 'video_start' | 'video_stop' | 'stream_start' | 'stream_stop' | 'channel_switch';
  userId: string;
  username: string;
  userTag: string;
  avatarUrl: string;
  channelName: string;
  message: string;
  durationFormatted?: string;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number; // decimal color code
  fields?: DiscordEmbedField[];
  author?: {
    name: string;
    icon_url?: string;
  };
  footer?: {
    text: string;
    icon_url?: string;
  };
  timestamp?: string;
}

export interface SlashCommandResponse {
  command: string;
  executedAt: number;
  content?: string;
  embeds: DiscordEmbed[];
}

// Attendance / payroll report shapes are defined next to the computation so the
// server and the UI can never drift apart.
export type { ReportPersonResult, ReportResponse, DayResult, DayStatus } from '../server/attendance';

export interface BotStatusConfig {
  mode: 'simulation' | 'live';
  discordConnected: boolean;
  botTag: string;
  guildCount: number;
  activeVoiceCount: number;
  activeVideoCount: number;
  activeStreamCount: number;
  totalLoggedSessions: number;
  totalTrackedMembers: number;
  uptimeSeconds: number;
  alertChannelName?: string;
  inactiveThresholdDays: number;
  autoAlertStream: boolean;
  autoAlertVideo: boolean;
}
