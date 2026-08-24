import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export async function getChannels() {
  const { data: channels, error: channelsError } = await supabase
    .from('voice_channels')
    .select('*');

  if (channelsError) {
    throw new Error(channelsError.message || 'Failed to load voice channels');
  }

  const guildIdFilter = process.env.DISCORD_GUILD_ID;
  let activeQuery = supabase.from('active_states').select('*');
  if (guildIdFilter) activeQuery = activeQuery.eq('guild_id', guildIdFilter);

  const { data: activeStates, error: activeError } = await activeQuery;

  if (activeError) {
    throw new Error(activeError.message || 'Failed to load active states');
  }

  return (channels || []).map((c) => {
    const membersInChannel = (activeStates || [])
      .filter((m) => m.channel_id === c.id)
      .map((m) => ({
        userId: m.user_id,
        username: m.username,
        userTag: m.user_tag,
        avatarUrl: m.avatar_url,
        channelId: m.channel_id,
        channelName: m.channel_name,
        guildId: m.guild_id,
        isVoice: m.is_voice,
        isVideo: m.is_video,
        isStreaming: m.is_streaming,
        selfMute: m.self_mute,
        selfDeaf: m.self_deaf,
        voiceStartTime: m.voice_start_time ? new Date(m.voice_start_time).getTime() : null,
        videoStartTime: m.video_start_time ? new Date(m.video_start_time).getTime() : null,
        streamStartTime: m.stream_start_time ? new Date(m.stream_start_time).getTime() : null,
        streamTitle: m.stream_title,
      }));

    return {
      id: c.id,
      name: c.name,
      members: membersInChannel,
    };
  });
}

export async function getAllActiveStates() {
  const guildIdFilter = process.env.DISCORD_GUILD_ID;
  let query = supabase.from('active_states').select('*');
  if (guildIdFilter) query = query.eq('guild_id', guildIdFilter);

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Failed to load active states');

  return (data || []).map((m) => ({
    userId: m.user_id,
    username: m.username,
    userTag: m.user_tag,
    avatarUrl: m.avatar_url,
    channelId: m.channel_id,
    channelName: m.channel_name,
    guildId: m.guild_id,
    isVoice: m.is_voice,
    isVideo: m.is_video,
    isStreaming: m.is_streaming,
    selfMute: m.self_mute,
    selfDeaf: m.self_deaf,
    voiceStartTime: m.voice_start_time ? new Date(m.voice_start_time).getTime() : null,
    videoStartTime: m.video_start_time ? new Date(m.video_start_time).getTime() : null,
    streamStartTime: m.stream_start_time ? new Date(m.stream_start_time).getTime() : null,
    streamTitle: m.stream_title,
  }));
}

export async function getAlertLogs(limit = 50) {
  const { data, error } = await supabase
    .from('alert_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message || 'Failed to load alert logs');

  return (data || []).map((log) => ({
    id: log.id,
    timestamp: new Date(log.timestamp).getTime(),
    type: log.type,
    userId: log.user_id,
    username: log.username,
    userTag: log.user_tag,
    avatarUrl: log.avatar_url,
    channelName: log.channel_name,
    message: log.message,
    durationFormatted: log.duration_formatted,
  }));
}

export async function getSessionHistory(filters) {
  let query = supabase
    .from('sessions')
    .select('*', { count: 'exact' })
    .order('start_time', { ascending: false });

  if (filters?.userId) query = query.eq('user_id', filters.userId);
  if (filters?.channelId) query = query.eq('channel_id', filters.channelId);
  if (filters?.activityType && filters.activityType !== 'all') {
    query = query.eq('activity_type', filters.activityType);
  }
  if (filters?.startDate) query = query.gte('start_time', filters.startDate);
  if (filters?.endDate) query = query.lte('start_time', filters.endDate);

  const offset = filters?.offset || 0;
  const limit = filters?.limit || 50;

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message || 'Failed to load sessions');

  const sessions = (data || []).map((s) => ({
    id: s.id,
    userId: s.user_id,
    username: s.username,
    userTag: s.user_tag,
    avatarUrl: s.avatar_url,
    guildId: s.guild_id,
    guildName: s.guild_name,
    channelId: s.channel_id,
    channelName: s.channel_name,
    activityType: s.activity_type,
    startTime: new Date(s.start_time).getTime(),
    endTime: s.end_time ? new Date(s.end_time).getTime() : null,
    durationSeconds: s.duration_seconds,
    isOngoing: s.is_ongoing,
    metadata: s.metadata,
  }));

  const total = count || 0;
  return { sessions, total, hasMore: offset + limit < total };
}

// Payroll-style report: aggregate voice/video/stream time per member over an
// arbitrary date range, checked against a target of 160 hours (40hrs x 4
// weeks), where at least 80% of that (128 hours) must be streamed for the
// member to be considered paid in full.
export async function getReport(params) {
  const TARGET_HOURS = 160;
  const REQUIRED_STREAM_PCT = 0.8;
  const REQUIRED_STREAM_HOURS = TARGET_HOURS * REQUIRED_STREAM_PCT;

  let query = supabase
    .from('sessions')
    .select('*')
    .gte('start_time', params.startDate)
    .lte('start_time', params.endDate);

  if (params.userIds && params.userIds.length > 0) {
    query = query.in('user_id', params.userIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Failed to load report data');

  // Local calendar-day key (not UTC) so "login"/"logout" line up with the
  // day a rep actually experienced.
  const dayKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Splits a [startMs, endMs) interval at local-midnight boundaries so a
  // session that runs past midnight contributes to each calendar day it
  // actually touched, instead of being attributed entirely to its start day.
  const splitByLocalDay = (startMs, endMs) => {
    const segments = [];
    let cursor = startMs;
    while (cursor < endMs) {
      const cursorDate = new Date(cursor);
      const nextDayStart = new Date(
        cursorDate.getFullYear(),
        cursorDate.getMonth(),
        cursorDate.getDate() + 1
      ).getTime();
      const segmentEnd = Math.min(endMs, nextDayStart);
      segments.push({ key: dayKey(cursorDate), startMs: cursor, endMs: segmentEnd });
      cursor = segmentEnd;
    }
    return segments;
  };

  const byUser = new Map();

  for (const s of data || []) {
    let entry = byUser.get(s.user_id);
    if (!entry) {
      entry = {
        userId: s.user_id,
        username: s.username,
        userTag: s.user_tag,
        avatarUrl: s.avatar_url,
        voiceSeconds: 0,
        videoSeconds: 0,
        streamSeconds: 0,
        sessionCount: 0,
        days: new Map(),
      };
      byUser.set(s.user_id, entry);
    }
    entry.sessionCount += 1;
    if (s.activity_type === 'voice') entry.voiceSeconds += s.duration_seconds;
    else if (s.activity_type === 'video') entry.videoSeconds += s.duration_seconds;
    else if (s.activity_type === 'stream') entry.streamSeconds += s.duration_seconds;

    if (s.activity_type === 'voice') {
      const startMs = new Date(s.start_time).getTime();
      const endMs = new Date(s.end_time).getTime();
      for (const seg of splitByLocalDay(startMs, endMs)) {
        const segSeconds = (seg.endMs - seg.startMs) / 1000;
        const day = entry.days.get(seg.key);
        if (!day) {
          entry.days.set(seg.key, { loginMs: seg.startMs, logoutMs: seg.endMs, voiceSeconds: segSeconds });
        } else {
          day.loginMs = Math.min(day.loginMs, seg.startMs);
          day.logoutMs = Math.max(day.logoutMs, seg.endMs);
          day.voiceSeconds += segSeconds;
        }
      }
    }
  }

  if (params.userIds) {
    for (const userId of params.userIds) {
      if (!byUser.has(userId)) {
        const { data: member } = await supabase
          .from('guild_members')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        byUser.set(userId, {
          userId,
          username: member?.username || 'Unknown',
          userTag: member?.user_tag || 'unknown',
          avatarUrl: member?.avatar_url || '',
          voiceSeconds: 0,
          videoSeconds: 0,
          streamSeconds: 0,
          sessionCount: 0,
          days: new Map(),
        });
      }
    }
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const formatTimeOfDay = (minutesOfDay) => {
    const h = Math.floor(minutesOfDay / 60);
    const m = Math.round(minutesOfDay % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const results = Array.from(byUser.values()).map((entry) => {
    const voiceHours = round2(entry.voiceSeconds / 3600);
    const videoHours = round2(entry.videoSeconds / 3600);
    const streamHours = round2(entry.streamSeconds / 3600);
    const streamPercentOfTarget = round2((streamHours / TARGET_HOURS) * 100);
    const paidFull = streamHours >= REQUIRED_STREAM_HOURS;

    const dayBuckets = Array.from(entry.days.values());
    const daysActive = dayBuckets.length;
    let totalSpanSeconds = 0;
    let totalBreakSeconds = 0;
    let loginMinutesSum = 0;
    let logoutMinutesSum = 0;

    for (const d of dayBuckets) {
      const spanSeconds = Math.max(0, (d.logoutMs - d.loginMs) / 1000);
      totalSpanSeconds += spanSeconds;
      totalBreakSeconds += Math.max(0, spanSeconds - d.voiceSeconds);

      const loginDate = new Date(d.loginMs);
      const logoutDate = new Date(d.logoutMs);
      loginMinutesSum += loginDate.getHours() * 60 + loginDate.getMinutes();
      logoutMinutesSum += logoutDate.getHours() * 60 + logoutDate.getMinutes();
    }

    const totalHours = round2(totalSpanSeconds / 3600);
    const totalHoursPercentOfTarget = round2((totalHours / TARGET_HOURS) * 100);
    const breakHours = round2(totalBreakSeconds / 3600);
    const avgLoginTime = daysActive > 0 ? formatTimeOfDay(loginMinutesSum / daysActive) : null;
    const avgLogoutTime = daysActive > 0 ? formatTimeOfDay(logoutMinutesSum / daysActive) : null;

    return {
      userId: entry.userId,
      username: entry.username,
      userTag: entry.userTag,
      avatarUrl: entry.avatarUrl,
      sessionCount: entry.sessionCount,
      voiceHours,
      videoHours,
      streamHours,
      streamPercentOfTarget,
      paidFull,
      daysActive,
      avgLoginTime,
      avgLogoutTime,
      breakHours,
      totalHours,
      totalHoursPercentOfTarget,
    };
  });

  results.sort((a, b) => b.streamHours - a.streamHours);

  return {
    startDate: params.startDate,
    endDate: params.endDate,
    targetHours: TARGET_HOURS,
    requiredStreamHours: REQUIRED_STREAM_HOURS,
    requiredStreamPercent: REQUIRED_STREAM_PCT * 100,
    results,
  };
}

export async function getUserStats(userId, timeframe = 'all') {
  const now = new Date();
  let minDate = null;

  if (timeframe === 'daily') minDate = new Date(now.getTime() - 24 * 3600 * 1000);
  else if (timeframe === 'weekly') minDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  else if (timeframe === 'monthly') minDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  let query = supabase.from('sessions').select('*').eq('user_id', userId);
  if (minDate) query = query.gte('start_time', minDate.toISOString());

  const { data: sessions, error: sessionsError } = await query;
  if (sessionsError) throw new Error(sessionsError.message || 'Failed to load user sessions');

  let voiceSec = 0;
  let videoSec = 0;
  let streamSec = 0;

  (sessions || []).forEach((s) => {
    if (s.activity_type === 'voice') voiceSec += s.duration_seconds;
    if (s.activity_type === 'video') videoSec += s.duration_seconds;
    if (s.activity_type === 'stream') streamSec += s.duration_seconds;
  });

  const { data: active } = await supabase
    .from('active_states')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (active) {
    const nowMs = now.getTime();
    if (active.is_voice && active.voice_start_time) {
      voiceSec += Math.floor((nowMs - new Date(active.voice_start_time).getTime()) / 1000);
    }
    if (active.is_video && active.video_start_time) {
      videoSec += Math.floor((nowMs - new Date(active.video_start_time).getTime()) / 1000);
    }
    if (active.is_streaming && active.stream_start_time) {
      streamSec += Math.floor((nowMs - new Date(active.stream_start_time).getTime()) / 1000);
    }
  }

  const { data: member } = await supabase
    .from('guild_members')
    .select('*')
    .eq('user_id', userId)
    .single();

  const memberData = member || {
    user_id: userId,
    username: active?.username || 'Unknown',
    user_tag: active?.user_tag || `User#${userId}`,
    avatar_url:
      active?.avatar_url ||
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=128&h=128&fit=crop&crop=faces',
  };

  return {
    user: {
      userId: memberData.user_id,
      username: memberData.username,
      userTag: memberData.user_tag,
      avatarUrl: memberData.avatar_url,
    },
    timeframe,
    totalVoiceSeconds: voiceSec,
    totalVideoSeconds: videoSec,
    totalStreamSeconds: streamSec,
    totalSeconds: voiceSec + videoSec + streamSec,
    sessionCount: (sessions || []).length + (active ? 1 : 0),
    isCurrentlyActive: !!active,
    currentChannel: active?.channel_name,
    recentSessions: (sessions || []).slice(0, 10).map((s) => ({
      id: s.id,
      userId: s.user_id,
      username: s.username,
      userTag: s.user_tag,
      avatarUrl: s.avatar_url,
      guildId: s.guild_id,
      guildName: s.guild_name,
      channelId: s.channel_id,
      channelName: s.channel_name,
      activityType: s.activity_type,
      startTime: new Date(s.start_time).getTime(),
      endTime: s.end_time ? new Date(s.end_time).getTime() : null,
      durationSeconds: s.duration_seconds,
      isOngoing: s.is_ongoing,
      metadata: s.metadata,
    })),
  };
}

export async function getLeaderboard(activityType = 'stream', timeframe = 'weekly') {
  const { data: members, error } = await supabase.from('guild_members').select('*');
  if (error) throw new Error(error.message || 'Failed to load guild members');

  const results = await Promise.all(
    (members || []).map(async (m) => {
      const stats = await getUserStats(m.user_id, timeframe);
      let score = 0;

      if (activityType === 'stream') score = stats.totalStreamSeconds;
      else if (activityType === 'video') score = stats.totalVideoSeconds;
      else if (activityType === 'voice') score = stats.totalVoiceSeconds;
      else score = stats.totalSeconds;

      return { ...stats, score };
    })
  );

  results.sort((a, b) => b.score - a.score);
  return results;
}

export async function getInactiveMembers(thresholdDays = 7) {
  const now = new Date();

  const [membersRes, activeStatesRes, sessionsRes] = await Promise.all([
    supabase.from('guild_members').select('*'),
    supabase.from('active_states').select('*'),
    supabase.from('sessions').select('user_id,activity_type,duration_seconds,end_time'),
  ]);

  const members = membersRes.data || [];
  const activeStates = activeStatesRes.data || [];
  const sessions = sessionsRes.data || [];

  const activeByUser = new Map();
  activeStates.forEach((a) => activeByUser.set(a.user_id, a));

  const sessionsByUser = new Map();
  sessions.forEach((s) => {
    const list = sessionsByUser.get(s.user_id) || [];
    list.push(s);
    sessionsByUser.set(s.user_id, list);
  });

  const summaries = members.map((m) => {
    const userSessions = sessionsByUser.get(m.user_id) || [];
    const activeState = activeByUser.get(m.user_id);
    const isActiveNow = !!activeState;

    let lastActive = m.joined_server_at ? new Date(m.joined_server_at).getTime() : now.getTime() - 30 * 86400000;
    let totalVoice = 0;
    let totalVideo = 0;
    let totalStream = 0;

    userSessions.forEach((session) => {
      if (session.end_time) {
        const endTime = new Date(session.end_time).getTime();
        if (endTime > lastActive) lastActive = endTime;
      }
      if (session.activity_type === 'voice') totalVoice += session.duration_seconds;
      if (session.activity_type === 'video') totalVideo += session.duration_seconds;
      if (session.activity_type === 'stream') totalStream += session.duration_seconds;
    });

    if (isActiveNow) lastActive = now.getTime();
    const daysSince = Math.floor((now.getTime() - lastActive) / 86400000);

    const currentActivities = [];
    if (activeState?.is_voice) currentActivities.push('voice');
    if (activeState?.is_video) currentActivities.push('video');
    if (activeState?.is_streaming) currentActivities.push('stream');

    return {
      userId: m.user_id,
      username: m.username,
      userTag: m.user_tag,
      avatarUrl: m.avatar_url,
      totalVoiceSeconds: totalVoice,
      totalVideoSeconds: totalVideo,
      totalStreamSeconds: totalStream,
      totalSessions: userSessions.length,
      lastActiveTimestamp: lastActive,
      isCurrentlyActive: isActiveNow,
      currentChannelName: activeState?.channel_name,
      currentActivities,
      daysSinceLastActive: daysSince,
    };
  });

  const inactiveOnly = summaries.filter(
    (m) =>
      !m.isCurrentlyActive &&
      now.getTime() - m.lastActiveTimestamp >= thresholdDays * 24 * 3600 * 1000
  );

  inactiveOnly.sort((a, b) => b.daysSinceLastActive - a.daysSinceLastActive);

  return {
    thresholdDays,
    totalGuildMembers: (members || []).length,
    inactiveCount: inactiveOnly.length,
    inactiveMembers: inactiveOnly,
    allMembers: summaries,
  };
}

export async function getOverviewAnalytics() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(today.getTime() - 6 * 86400000);

  const guildIdFilter = process.env.DISCORD_GUILD_ID;

  const [activeStatesRes, sessionsCountRes, memberCountRes, channels] = await Promise.all([
    guildIdFilter
      ? supabase.from('active_states').select('*').eq('guild_id', guildIdFilter)
      : supabase.from('active_states').select('*'),
    supabase.from('sessions').select('*', { count: 'exact', head: true }),
    supabase.from('guild_members').select('*', { count: 'exact', head: true }),
    getChannels(),
  ]);

  const activeStates = activeStatesRes.data || [];
  const activeVoiceCount = activeStates.length;
  const activeVideoCount = activeStates.filter((s) => s.is_video).length;
  const activeStreamCount = activeStates.filter((s) => s.is_streaming).length;

  const { data: sessions7d, error: sessions7dError } = await supabase
    .from('sessions')
    .select('activity_type,duration_seconds,start_time')
    .gte('start_time', sevenDaysAgo.toISOString());

  if (sessions7dError) throw new Error(sessions7dError.message || 'Failed to load recent sessions');

  let totalVoiceSec = 0;
  let totalVideoSec = 0;
  let totalStreamSec = 0;

  (sessions7d || []).forEach((s) => {
    if (s.activity_type === 'voice') totalVoiceSec += s.duration_seconds;
    if (s.activity_type === 'video') totalVideoSec += s.duration_seconds;
    if (s.activity_type === 'stream') totalStreamSec += s.duration_seconds;
  });

  const dailyBreakdown = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dayStart = d.getTime();
    const dayEnd = dayStart + 86400000;

    let vH = 0;
    let vidH = 0;
    let sH = 0;

    (sessions7d || []).forEach((s) => {
      const sStart = new Date(s.start_time).getTime();
      if (sStart >= dayStart && sStart < dayEnd) {
        if (s.activity_type === 'voice') vH += s.duration_seconds / 3600;
        if (s.activity_type === 'video') vidH += s.duration_seconds / 3600;
        if (s.activity_type === 'stream') sH += s.duration_seconds / 3600;
      }
    });

    dailyBreakdown.push({
      date: dateStr,
      voiceHours: Number(vH.toFixed(1)),
      videoHours: Number(vidH.toFixed(1)),
      streamHours: Number(sH.toFixed(1)),
    });
  }

  return {
    activeVoiceCount,
    activeVideoCount,
    activeStreamCount,
    totalSessionsCount: sessionsCountRes.count || 0,
    totalGuildMembersCount: memberCountRes.count || 0,
    totalVoiceHours: Number((totalVoiceSec / 3600).toFixed(1)),
    totalVideoHours: Number((totalVideoSec / 3600).toFixed(1)),
    totalStreamHours: Number((totalStreamSec / 3600).toFixed(1)),
    dailyBreakdown,
    channels,
  };
}
