// Daily stream check.
//
// Discord never gives a bot the video of someone's screen share, so the bot
// cannot screenshot what a rep is streaming. What it CAN do is tell you, once
// a day, exactly who to look at — with links that open each person's voice
// channel in one click, so checking the floor takes seconds instead of
// scrolling the member list.
//
// Three groups, which is the whole point:
//   LIVE        — streaming right now
//   NOT LIVE    — in voice but not sharing their screen (the compliance gap)
//   NOT ONLINE  — on the recent roster but not in voice at all today

import { ActiveMemberState } from '../src/types';
import { configFromEnv, zonedParts } from './attendance';

export interface StreamCheckRow {
  userId: string;
  username: string;
  channelId?: string;
  channelName?: string;
  sinceMs?: number;
}

export interface StreamCheckResult {
  generatedAt: number;
  localTime: string;
  localDate: string;
  live: StreamCheckRow[];
  inVoiceNotLive: StreamCheckRow[];
  notOnline: StreamCheckRow[];
  rosterSize: number;
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function buildStreamCheck(params: {
  active: ActiveMemberState[];
  roster: { userId: string; username: string }[];
  guildId?: string;
  now?: number;
}): StreamCheckResult {
  const now = params.now ?? Date.now();
  const tz = configFromEnv().timezone;
  const p = zonedParts(now, tz);

  const live: StreamCheckRow[] = [];
  const inVoiceNotLive: StreamCheckRow[] = [];
  const activeIds = new Set<string>();

  for (const a of params.active) {
    activeIds.add(a.userId);
    const row: StreamCheckRow = {
      userId: a.userId,
      username: a.username,
      channelId: a.channelId,
      channelName: a.channelName,
      sinceMs: a.isStreaming && a.streamStartTime ? a.streamStartTime : a.voiceStartTime,
    };
    if (a.isStreaming) live.push(row);
    else inVoiceNotLive.push(row);
  }

  const notOnline = params.roster
    .filter((m) => !activeIds.has(m.userId))
    .map((m) => ({ userId: m.userId, username: m.username }));

  const byName = (a: StreamCheckRow, b: StreamCheckRow) => a.username.localeCompare(b.username);
  live.sort(byName);
  inVoiceNotLive.sort(byName);
  notOnline.sort(byName);

  return {
    generatedAt: now,
    localTime: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
    localDate: new Date(now).toLocaleDateString('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
    live,
    inVoiceNotLive,
    notOnline,
    rosterSize: params.roster.length,
  };
}

// Discord embed field values cap at 1024 characters, so long lists are trimmed
// rather than silently dropped by the API.
function clampList(lines: string[], emptyText: string): string {
  if (lines.length === 0) return emptyText;
  const out: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > 960) {
      out.push(`*...and ${lines.length - out.length} more*`);
      break;
    }
    out.push(line);
    length += line.length + 1;
  }
  return out.join('\n');
}

export function renderStreamCheckEmbed(result: StreamCheckResult, guildId?: string) {
  const link = (row: StreamCheckRow) =>
    guildId && row.channelId
      ? `https://discord.com/channels/${guildId}/${row.channelId}`
      : null;

  const liveLines = result.live.map((r) => {
    const url = link(r);
    const dur = r.sinceMs ? ` — live ${formatDuration((result.generatedAt - r.sinceMs) / 1000)}` : '';
    const name = url ? `**[${r.username}](${url})**` : `**${r.username}**`;
    return `🔴 ${name}${dur}`;
  });

  const notLiveLines = result.inVoiceNotLive.map((r) => {
    const url = link(r);
    const dur = r.sinceMs ? ` — in voice ${formatDuration((result.generatedAt - r.sinceMs) / 1000)}` : '';
    const name = url ? `**[${r.username}](${url})**` : `**${r.username}**`;
    return `🔇 ${name}${dur}`;
  });

  const offlineLines = result.notOnline.map((r) => `⚪ ${r.username}`);

  const total = result.live.length + result.inVoiceNotLive.length;
  const color = result.inVoiceNotLive.length > 0 ? 0xfee75c : result.live.length > 0 ? 0x57f287 : 0xed4245;

  return {
    title: `📋 Daily Stream Check — ${result.localDate}, ${result.localTime}`,
    description:
      `**${result.live.length}** streaming · **${result.inVoiceNotLive.length}** in voice without streaming · ` +
      `**${result.notOnline.length}** not online.\n` +
      `Click a name to open their channel and watch the stream.`,
    color,
    fields: [
      {
        name: `🔴 Streaming now (${result.live.length})`,
        value: clampList(liveLines, '*Nobody is screen-sharing right now.*'),
        inline: false,
      },
      {
        name: `🔇 In voice, not streaming (${result.inVoiceNotLive.length})`,
        value: clampList(notLiveLines, '*Everyone in voice is streaming.*'),
        inline: false,
      },
      {
        name: `⚪ Not in voice (${result.notOnline.length} of ${result.rosterSize} on roster)`,
        value: clampList(offlineLines, '*Everyone on the roster is online.*'),
        inline: false,
      },
    ],
    footer: { text: `${total} on the floor • Planet Rep tracker` },
    timestamp: new Date(result.generatedAt).toISOString(),
  };
}

// Next occurrence of HH:MM in the office timezone, strictly after `now`.
// Recomputed from scratch each day so DST shifts can't drift the schedule.
export function nextRunAt(now: number, hhmm: string, includeWeekends: boolean): number {
  const tz = configFromEnv().timezone;
  const [targetH, targetM] = hhmm.split(':').map(Number);

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const probe = now + dayOffset * 86400000;
    const p = zonedParts(probe, tz);
    if (!includeWeekends && (p.weekday === 0 || p.weekday === 6)) continue;

    // Walk minutes from local midnight rather than adding a fixed offset, so a
    // DST jump on this date lands on the real wall-clock time.
    const midnight = Date.UTC(p.year, p.month - 1, p.day) - 0;
    let candidate = probe - ((p.hour * 60 + p.minute) * 60000 + p.second * 1000);
    candidate += (targetH * 60 + targetM) * 60000;

    // Correct for a DST boundary crossed between midnight and the target time.
    const check = zonedParts(candidate, tz);
    const drift = (check.hour * 60 + check.minute) - (targetH * 60 + targetM);
    if (drift !== 0 && Math.abs(drift) <= 120) candidate -= drift * 60000;

    if (candidate > now) return candidate;
  }
  return now + 86400000;
}
