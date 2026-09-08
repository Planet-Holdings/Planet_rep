// Pure attendance / payroll computation shared by the Express server (server/db.ts)
// and the Vercel API handler (api/report.ts). No database access here: it takes
// raw session rows and returns the finished report.
//
// All "days", clock-in/out times and schedule comparisons are computed in the
// office timezone (default America/New_York — Miami), not the server's timezone.

export interface SessionRow {
  user_id: string;
  username: string;
  user_tag: string;
  avatar_url: string | null;
  activity_type: 'voice' | 'video' | 'stream';
  start_time: string;
  end_time: string;
  duration_seconds?: number;
}

export interface MemberRow {
  user_id: string;
  username: string;
  user_tag: string;
  avatar_url: string | null;
}

export interface ActiveStateRow {
  user_id: string;
  username: string;
  user_tag: string;
  avatar_url: string | null;
  is_voice: boolean;
  is_streaming: boolean;
  is_video: boolean;
  voice_start_time: string | null;
  stream_start_time: string | null;
  video_start_time: string | null;
}

export interface AttendanceConfig {
  timezone: string;
  scheduleStart: string; // "HH:MM" in office timezone
  scheduleEnd: string; // "HH:MM" in office timezone
  hoursPerDay: number; // target hours per working day (Mon–Fri)
  requiredStreamPct: number; // fraction of target that must be streamed for full pay
  lunchMinGapMinutes: number; // longest gap at/above this counts as lunch
  lateGraceMinutes: number; // minutes past schedule start before a day counts as late
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AttendanceConfig {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    timezone: env.SCHEDULE_TZ || 'America/New_York',
    scheduleStart: env.SCHEDULE_START || '09:00',
    scheduleEnd: env.SCHEDULE_END || '18:30',
    hoursPerDay: num(env.TARGET_HOURS_PER_DAY, 8),
    requiredStreamPct: num(env.REQUIRED_STREAM_PCT, 0.8),
    lunchMinGapMinutes: num(env.LUNCH_MIN_GAP_MINUTES, 20),
    lateGraceMinutes: Number.isFinite(Number(env.LATE_GRACE_MINUTES)) ? Number(env.LATE_GRACE_MINUTES) : 5,
  };
}

// ---------------------------------------------------------------------------
// Timezone helpers (Intl-based, no dependencies)
// ---------------------------------------------------------------------------

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function zonedParts(ms: number, tz: string): ZonedParts {
  const parts = formatterFor(tz).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

// Offset (ms) of the zone at the given instant: zoneWallClock - utc.
function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

// UTC instant of local midnight for the given calendar date in the zone.
// `day` may overflow (e.g. day + 1) — Date.UTC normalises it.
export function zonedMidnightUtc(year: number, month: number, day: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const off1 = tzOffsetMs(guess, tz);
  let result = guess - off1;
  const off2 = tzOffsetMs(result, tz);
  if (off2 !== off1) result = guess - off2;
  return result;
}

export function dateKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatClock(minutesOfDay: number): string {
  const total = Math.round(minutesOfDay);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface ResolvedRange {
  startMs: number;
  endMs: number; // exclusive
}

// Accepts either plain calendar dates ("YYYY-MM-DD", interpreted in the office
// timezone, end date inclusive) or ISO timestamps (end treated as inclusive).
export function resolveRange(startDate: string, endDate: string, tz: string): ResolvedRange {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  let startMs: number;
  let endMs: number;
  if (dateOnly.test(startDate)) {
    const s = parseDateKey(startDate);
    startMs = zonedMidnightUtc(s.year, s.month, s.day, tz);
  } else {
    startMs = Date.parse(startDate);
  }
  if (dateOnly.test(endDate)) {
    const e = parseDateKey(endDate);
    endMs = zonedMidnightUtc(e.year, e.month, e.day + 1, tz);
  } else {
    endMs = Date.parse(endDate) + 1;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('Invalid startDate/endDate');
  }
  return { startMs, endMs };
}

interface DayInfo {
  key: string;
  weekday: number;
  isWorkday: boolean;
  startMs: number;
  endMs: number;
}

function listDays(range: ResolvedRange, tz: string): DayInfo[] {
  const days: DayInfo[] = [];
  let cursor = range.startMs;
  while (cursor < range.endMs) {
    const p = zonedParts(cursor, tz);
    const dayStart = zonedMidnightUtc(p.year, p.month, p.day, tz);
    const next = zonedMidnightUtc(p.year, p.month, p.day + 1, tz);
    if (next <= cursor) break; // defensive: never loop forever
    days.push({
      key: dateKey(p),
      weekday: p.weekday,
      isWorkday: p.weekday >= 1 && p.weekday <= 5,
      startMs: dayStart,
      endMs: next,
    });
    cursor = next;
  }
  return days;
}

interface Interval {
  startMs: number;
  endMs: number;
}

function splitByLocalDay(startMs: number, endMs: number, tz: string): { key: string; startMs: number; endMs: number }[] {
  const segments: { key: string; startMs: number; endMs: number }[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const p = zonedParts(cursor, tz);
    const next = zonedMidnightUtc(p.year, p.month, p.day + 1, tz);
    if (next <= cursor) break;
    const segEnd = Math.min(endMs, next);
    segments.push({ key: dateKey(p), startMs: cursor, endMs: segEnd });
    cursor = segEnd;
  }
  return segments;
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, iv.endMs);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export type DayStatus = 'on_time' | 'late' | 'left_early' | 'late_and_left_early';

export interface DayResult {
  date: string; // YYYY-MM-DD (office timezone)
  weekday: string; // Mon, Tue, ...
  isWorkday: boolean;
  clockIn: string; // HH:MM office time
  clockOut: string; // HH:MM office time
  clockInMs: number;
  clockOutMs: number;
  ongoing: boolean; // still in voice when the report was generated
  spanHours: number; // clock in -> clock out
  workedHours: number; // time actually in voice
  lunchMinutes: number; // longest gap (>= lunchMinGapMinutes)
  breakMinutes: number; // all other gaps
  streamHours: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  status: DayStatus;
}

export interface ReportPersonResult {
  userId: string;
  username: string;
  userTag: string;
  avatarUrl: string;
  sessionCount: number;
  voiceHours: number;
  videoHours: number;
  streamHours: number;
  streamPercentOfTarget: number;
  paidFull: boolean;
  daysActive: number;
  workdaysMissed: number;
  avgClockIn: string | null;
  avgClockOut: string | null;
  // Backwards-compatible aliases (older UI/CSV used these names)
  avgLoginTime: string | null;
  avgLogoutTime: string | null;
  avgLateMinutes: number;
  avgEarlyLeaveMinutes: number;
  lateDays: number;
  earlyLeaveDays: number;
  onTimeDays: number;
  lunchHours: number;
  breakHours: number;
  workedHours: number;
  totalHours: number; // sum of daily clock-in -> clock-out spans
  totalHoursPercentOfTarget: number;
  days: DayResult[];
}

export interface ReportResponse {
  startDate: string;
  endDate: string;
  timezone: string;
  schedule: { start: string; end: string };
  hoursPerDay: number;
  workingDays: number;
  calendarDays: number;
  targetHours: number;
  requiredStreamHours: number;
  requiredStreamPercent: number;
  lateGraceMinutes: number;
  results: ReportPersonResult[];
}

export interface BuildReportInput {
  sessions: SessionRow[];
  activeStates?: ActiveStateRow[]; // members currently in voice — counted up to `now`
  members?: MemberRow[]; // fallback identity for requested members with no activity
  userIds?: string[];
  startDate: string;
  endDate: string;
  config: AttendanceConfig;
  now?: number;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

export function buildAttendanceReport(input: BuildReportInput): ReportResponse {
  const cfg = input.config;
  const tz = cfg.timezone;
  const now = input.now ?? Date.now();
  const range = resolveRange(input.startDate, input.endDate, tz);
  const days = listDays(range, tz);
  const workingDays = days.filter((d) => d.isWorkday).length;
  const targetHours = workingDays * cfg.hoursPerDay;
  const requiredStreamHours = round2(targetHours * cfg.requiredStreamPct);
  const scheduleStartMin = parseClock(cfg.scheduleStart);
  const scheduleEndMin = parseClock(cfg.scheduleEnd);
  const dayByKey = new Map(days.map((d) => [d.key, d]));

  interface UserAgg {
    userId: string;
    username: string;
    userTag: string;
    avatarUrl: string;
    sessionCount: number;
    voiceSeconds: number;
    videoSeconds: number;
    streamSeconds: number;
    days: Map<string, { voice: Interval[]; streamSeconds: number; ongoing: boolean }>;
  }
  const byUser = new Map<string, UserAgg>();

  const getUser = (id: string, username: string, userTag: string, avatarUrl: string | null) => {
    let u = byUser.get(id);
    if (!u) {
      u = {
        userId: id,
        username,
        userTag,
        avatarUrl: avatarUrl || '',
        sessionCount: 0,
        voiceSeconds: 0,
        videoSeconds: 0,
        streamSeconds: 0,
        days: new Map(),
      };
      byUser.set(id, u);
    }
    return u;
  };

  const ingest = (
    user: UserAgg,
    type: 'voice' | 'video' | 'stream',
    rawStart: number,
    rawEnd: number,
    ongoing: boolean
  ) => {
    // Clip to the report window so sessions crossing its edges only count the inside part.
    const startMs = Math.max(rawStart, range.startMs);
    const endMs = Math.min(rawEnd, range.endMs);
    if (!(endMs > startMs)) return;
    const seconds = (endMs - startMs) / 1000;
    if (type === 'voice') user.voiceSeconds += seconds;
    else if (type === 'video') user.videoSeconds += seconds;
    else user.streamSeconds += seconds;

    if (type === 'video') return;
    for (const seg of splitByLocalDay(startMs, endMs, tz)) {
      let day = user.days.get(seg.key);
      if (!day) {
        day = { voice: [], streamSeconds: 0, ongoing: false };
        user.days.set(seg.key, day);
      }
      if (type === 'voice') {
        day.voice.push({ startMs: seg.startMs, endMs: seg.endMs });
        if (ongoing && seg.endMs === endMs) day.ongoing = true;
      } else {
        day.streamSeconds += (seg.endMs - seg.startMs) / 1000;
      }
    }
  };

  const requested = input.userIds && input.userIds.length > 0 ? new Set(input.userIds) : null;

  for (const s of input.sessions) {
    if (requested && !requested.has(s.user_id)) continue;
    const startMs = Date.parse(s.start_time);
    const endMs = Date.parse(s.end_time);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const user = getUser(s.user_id, s.username, s.user_tag, s.avatar_url);
    user.sessionCount += 1;
    ingest(user, s.activity_type, startMs, endMs, false);
  }

  // Members currently in voice: count their in-progress time up to now so a
  // report for "today" shows a clock-in and hours-so-far before they leave.
  for (const a of input.activeStates || []) {
    if (requested && !requested.has(a.user_id)) continue;
    const user = getUser(a.user_id, a.username, a.user_tag, a.avatar_url);
    if (a.is_voice && a.voice_start_time) {
      const st = Date.parse(a.voice_start_time);
      if (Number.isFinite(st) && st < now) {
        user.sessionCount += 1;
        ingest(user, 'voice', st, now, true);
      }
    }
    if (a.is_streaming && a.stream_start_time) {
      const st = Date.parse(a.stream_start_time);
      if (Number.isFinite(st) && st < now) ingest(user, 'stream', st, now, true);
    }
    if (a.is_video && a.video_start_time) {
      const st = Date.parse(a.video_start_time);
      if (Number.isFinite(st) && st < now) ingest(user, 'video', st, now, true);
    }
  }

  // Every explicitly requested member appears, even with zero activity.
  if (requested) {
    for (const id of requested) {
      if (!byUser.has(id)) {
        const m = (input.members || []).find((x) => x.user_id === id);
        getUser(id, m?.username || 'Unknown', m?.user_tag || 'unknown', m?.avatar_url || '');
      }
    }
  }

  const results: ReportPersonResult[] = Array.from(byUser.values()).map((u) => {
    const dayResults: DayResult[] = [];
    let spanSecondsSum = 0;
    let workedSecondsSum = 0;
    let lunchMinutesSum = 0;
    let breakMinutesSum = 0;
    let clockInMinSum = 0;
    let clockOutMinSum = 0;
    let lateMinSum = 0;
    let earlySum = 0;
    let lateDays = 0;
    let earlyLeaveDays = 0;
    let onTimeDays = 0;

    for (const [key, d] of u.days) {
      const merged = mergeIntervals(d.voice);
      if (merged.length === 0) continue; // stream-only bucket without voice (shouldn't happen)
      const info = dayByKey.get(key);
      const p = parseDateKey(key);
      const dayStart = info?.startMs ?? zonedMidnightUtc(p.year, p.month, p.day, tz);
      const dayEnd = info?.endMs ?? zonedMidnightUtc(p.year, p.month, p.day + 1, tz);
      const weekdayIdx = info?.weekday ?? zonedParts(dayStart, tz).weekday;
      const isWorkday = weekdayIdx >= 1 && weekdayIdx <= 5;

      const clockInMs = merged[0].startMs;
      const clockOutMs = merged[merged.length - 1].endMs;
      const workedSeconds = merged.reduce((acc, iv) => acc + (iv.endMs - iv.startMs) / 1000, 0);
      const spanSeconds = (clockOutMs - clockInMs) / 1000;

      let longestGap = 0;
      let totalGap = 0;
      for (let i = 1; i < merged.length; i++) {
        const gap = (merged[i].startMs - merged[i - 1].endMs) / 60000;
        totalGap += gap;
        if (gap > longestGap) longestGap = gap;
      }
      const lunchMinutes = longestGap >= cfg.lunchMinGapMinutes ? longestGap : 0;
      const breakMinutes = Math.max(0, totalGap - lunchMinutes);

      const minutesOfDay = (ms: number) => {
        if (ms >= dayEnd) return 24 * 60;
        const zp = zonedParts(ms, tz);
        return zp.hour * 60 + zp.minute + zp.second / 60;
      };
      const clockInMin = minutesOfDay(clockInMs);
      const clockOutMin = minutesOfDay(clockOutMs);
      const lateMinutes = Math.max(0, clockInMin - scheduleStartMin);
      // Someone still in voice hasn't "left" yet, so don't flag an early leave.
      const earlyLeaveMinutes = d.ongoing ? 0 : Math.max(0, scheduleEndMin - clockOutMin);
      const isLate = lateMinutes > cfg.lateGraceMinutes;
      const isEarly = earlyLeaveMinutes > cfg.lateGraceMinutes;
      const status: DayStatus = isLate && isEarly ? 'late_and_left_early' : isLate ? 'late' : isEarly ? 'left_early' : 'on_time';

      spanSecondsSum += spanSeconds;
      workedSecondsSum += workedSeconds;
      lunchMinutesSum += lunchMinutes;
      breakMinutesSum += breakMinutes;
      clockInMinSum += clockInMin;
      clockOutMinSum += clockOutMin;
      lateMinSum += lateMinutes;
      earlySum += earlyLeaveMinutes;
      if (isLate) lateDays++;
      if (isEarly) earlyLeaveDays++;
      if (!isLate && !isEarly) onTimeDays++;

      dayResults.push({
        date: key,
        weekday: WEEKDAY_NAMES[weekdayIdx],
        isWorkday,
        clockIn: formatClock(clockInMin),
        clockOut: d.ongoing ? 'now' : formatClock(clockOutMin),
        clockInMs,
        clockOutMs,
        ongoing: d.ongoing,
        spanHours: round2(spanSeconds / 3600),
        workedHours: round2(workedSeconds / 3600),
        lunchMinutes: Math.round(lunchMinutes),
        breakMinutes: Math.round(breakMinutes),
        streamHours: round2(d.streamSeconds / 3600),
        lateMinutes: Math.round(lateMinutes),
        earlyLeaveMinutes: Math.round(earlyLeaveMinutes),
        status,
      });
    }

    dayResults.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const daysActive = dayResults.length;
    const activeKeys = new Set(dayResults.map((d) => d.date));
    const todayKey = dateKey(zonedParts(now, tz));
    const workdaysMissed = days.filter((d) => d.isWorkday && d.key < todayKey && !activeKeys.has(d.key)).length;

    const voiceHours = round2(u.voiceSeconds / 3600);
    const videoHours = round2(u.videoSeconds / 3600);
    const streamHours = round2(u.streamSeconds / 3600);
    const totalHours = round2(spanSecondsSum / 3600);
    const pct = (h: number) => (targetHours > 0 ? round2((h / targetHours) * 100) : 0);
    const avgClockIn = daysActive > 0 ? formatClock(clockInMinSum / daysActive) : null;
    const avgClockOut = daysActive > 0 ? formatClock(clockOutMinSum / daysActive) : null;

    return {
      userId: u.userId,
      username: u.username,
      userTag: u.userTag,
      avatarUrl: u.avatarUrl,
      sessionCount: u.sessionCount,
      voiceHours,
      videoHours,
      streamHours,
      streamPercentOfTarget: pct(streamHours),
      paidFull: targetHours > 0 && streamHours >= requiredStreamHours,
      daysActive,
      workdaysMissed,
      avgClockIn,
      avgClockOut,
      avgLoginTime: avgClockIn,
      avgLogoutTime: avgClockOut,
      avgLateMinutes: daysActive > 0 ? Math.round(lateMinSum / daysActive) : 0,
      avgEarlyLeaveMinutes: daysActive > 0 ? Math.round(earlySum / daysActive) : 0,
      lateDays,
      earlyLeaveDays,
      onTimeDays,
      lunchHours: round2(lunchMinutesSum / 60),
      breakHours: round2(breakMinutesSum / 60),
      workedHours: round2(workedSecondsSum / 3600),
      totalHours,
      totalHoursPercentOfTarget: pct(totalHours),
      days: dayResults,
    };
  });

  results.sort((a, b) => b.streamHours - a.streamHours);

  return {
    startDate: new Date(range.startMs).toISOString(),
    endDate: new Date(range.endMs - 1).toISOString(),
    timezone: tz,
    schedule: { start: cfg.scheduleStart, end: cfg.scheduleEnd },
    hoursPerDay: cfg.hoursPerDay,
    workingDays,
    calendarDays: days.length,
    targetHours,
    requiredStreamHours,
    requiredStreamPercent: cfg.requiredStreamPct * 100,
    lateGraceMinutes: cfg.lateGraceMinutes,
    results,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
