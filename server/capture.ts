// Screenshot capture store for the workstation agent.
//
// How the feature works end to end:
//   1. A small agent script runs on each rep's own machine (see agent/).
//   2. Every few minutes it asks the server "should I capture right now?".
//   3. The server says yes only while that member is actually screen-sharing
//      in Discord and hasn't been captured yet today (office timezone), so the
//      image always shows what they were streaming.
//   4. The agent takes one screenshot with the OS's built-in tool and POSTs it.
//
// Images live on the Railway volume mounted at CAPTURE_DIR (default /data),
// one folder per office-timezone day, pruned after CAPTURE_RETENTION_DAYS.
// This is openly-installed workforce monitoring: the agent is not hidden, it
// logs what it does locally, and setup tells the operator to disclose it.

import fs from 'fs';
import path from 'path';
import { configFromEnv, zonedParts, dateKey } from './attendance';

const CAPTURE_DIR = process.env.CAPTURE_DIR || '/data/captures';
const RETENTION_DAYS = Number(process.env.CAPTURE_RETENTION_DAYS) || 90;
// Minimum spacing between captures for one member, in minutes. With the
// default of one capture per day this only guards against duplicate uploads.
const MIN_GAP_MINUTES = Number(process.env.CAPTURE_MIN_GAP_MINUTES) || 60;
const CAPTURES_PER_DAY = Number(process.env.CAPTURES_PER_DAY) || 1;
const MAX_BYTES = Number(process.env.CAPTURE_MAX_BYTES) || 8 * 1024 * 1024;

// agent  = captured automatically by the workstation agent
// discord = the rep posted a screenshot in Discord and the bot filed it
// manual  = a manager uploaded it from the dashboard
export type CaptureSource = 'agent' | 'discord' | 'manual';

export interface CaptureRecord {
  id: string;
  userId: string;
  username: string;
  date: string; // YYYY-MM-DD in office timezone
  takenAt: number; // epoch ms
  takenAtLocal: string; // HH:MM in office timezone
  channelName: string | null;
  bytes: number;
  ext: 'png' | 'jpg';
  source: CaptureSource;
  note: string | null;
  agentHost: string | null;
  agentPlatform: string | null;
}

function officeTz(): string {
  return configFromEnv().timezone;
}

export function todayKey(now = Date.now()): string {
  return dateKey(zonedParts(now, officeTz()));
}

function localHhmm(ms: number): string {
  const p = zonedParts(ms, officeTz());
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function dayDir(date: string): string {
  return path.join(CAPTURE_DIR, date);
}

function metaPath(date: string): string {
  return path.join(dayDir(date), 'index.json');
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function isConfigured(): boolean {
  return !!(process.env.CAPTURE_TOKEN && process.env.CAPTURE_TOKEN.trim());
}

export function checkToken(token: string | undefined): boolean {
  const expected = process.env.CAPTURE_TOKEN;
  if (!expected || !expected.trim()) return false;
  if (!token) return false;
  // Length-independent comparison is unnecessary here (the token is a shared
  // deploy secret, not a user password), but keep it constant-ish anyway.
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function readDay(date: string): CaptureRecord[] {
  try {
    const raw = fs.readFileSync(metaPath(date), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDay(date: string, records: CaptureRecord[]) {
  ensureDir(dayDir(date));
  const tmp = `${metaPath(date)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 1));
  fs.renameSync(tmp, metaPath(date));
}

export function listDates(): string[] {
  try {
    return fs
      .readdirSync(CAPTURE_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function listCaptures(params: { date?: string; userId?: string; limit?: number }): {
  captures: CaptureRecord[];
  dates: string[];
} {
  const dates = listDates();
  const wanted = params.date ? [params.date] : dates.slice(0, 14);
  const limit = params.limit || 500;

  const captures: CaptureRecord[] = [];
  for (const d of wanted) {
    for (const rec of readDay(d)) {
      if (params.userId && rec.userId !== params.userId) continue;
      captures.push(rec);
      if (captures.length >= limit) break;
    }
    if (captures.length >= limit) break;
  }
  captures.sort((a, b) => b.takenAt - a.takenAt);
  return { captures, dates };
}

export function findCapture(id: string): { record: CaptureRecord; file: string } | null {
  // ids are `${date}_${userId}_${takenAt}` so the day is known without scanning.
  const date = id.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const record = readDay(date).find((r) => r.id === id);
  if (!record) return null;
  const file = path.join(dayDir(date), `${id}.${record.ext || 'png'}`);
  if (!fs.existsSync(file)) return null;
  return { record, file };
}

export function deleteCapture(id: string): boolean {
  const date = id.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const records = readDay(date);
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  const [removed] = records.splice(idx, 1);
  try {
    fs.rmSync(path.join(dayDir(date), `${id}.${removed.ext || 'png'}`), { force: true });
  } catch (e) {
    console.error('[Capture] Failed to remove image file:', e);
  }
  writeDay(date, records);
  return true;
}

// Decides whether the agent on this member's machine should capture now.
export function shouldCapture(params: {
  userId: string;
  isStreaming: boolean;
  now?: number;
}): { capture: boolean; reason: string; takenToday: number } {
  const now = params.now ?? Date.now();
  const date = todayKey(now);
  // Manual uploads by a manager don't satisfy the agent's daily quota — the
  // two are independent ways of getting an image for the same person.
  const mine = readDay(date).filter((r) => r.userId === params.userId && r.source !== 'manual');

  if (!params.isStreaming) {
    return { capture: false, reason: 'not_streaming', takenToday: mine.length };
  }
  if (mine.length >= CAPTURES_PER_DAY) {
    return { capture: false, reason: 'already_captured_today', takenToday: mine.length };
  }
  const last = mine.reduce((acc, r) => Math.max(acc, r.takenAt), 0);
  if (last && now - last < MIN_GAP_MINUTES * 60 * 1000) {
    return { capture: false, reason: 'too_soon', takenToday: mine.length };
  }
  return { capture: true, reason: 'streaming', takenToday: mine.length };
}

// Returns the image kind from its magic number, or null if it is neither.
function detectImage(buf: Buffer): 'png' | 'jpg' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'png';
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  return null;
}

export function saveCapture(params: {
  userId: string;
  username: string;
  channelName: string | null;
  agentHost: string | null;
  agentPlatform: string | null;
  image: Buffer;
  source?: CaptureSource;
  note?: string | null;
  now?: number;
}): CaptureRecord {
  if (!params.image || params.image.length === 0) {
    throw new Error('Empty image body');
  }
  if (params.image.length > MAX_BYTES) {
    throw new Error(`Image too large (${params.image.length} bytes, max ${MAX_BYTES})`);
  }
  const ext = detectImage(params.image);
  if (!ext) throw new Error('File must be a PNG or JPEG image');

  const now = params.now ?? Date.now();
  const date = todayKey(now);
  const id = `${date}_${params.userId}_${now}`;

  ensureDir(dayDir(date));
  fs.writeFileSync(path.join(dayDir(date), `${id}.${ext}`), params.image);

  const record: CaptureRecord = {
    id,
    userId: params.userId,
    username: params.username,
    date,
    takenAt: now,
    takenAtLocal: localHhmm(now),
    channelName: params.channelName,
    bytes: params.image.length,
    ext,
    source: params.source || 'agent',
    note: params.note || null,
    agentHost: params.agentHost,
    agentPlatform: params.agentPlatform,
  };

  const records = readDay(date);
  records.push(record);
  writeDay(date, records);

  pruneOldCaptures();
  return record;
}

let lastPrune = 0;
export function pruneOldCaptures(force = false) {
  const now = Date.now();
  if (!force && now - lastPrune < 6 * 3600 * 1000) return;
  lastPrune = now;
  try {
    const cutoff = dateKey(zonedParts(now - RETENTION_DAYS * 86400000, officeTz()));
    for (const date of listDates()) {
      if (date < cutoff) {
        fs.rmSync(dayDir(date), { recursive: true, force: true });
        console.log(`[Capture] Pruned captures for ${date} (older than ${RETENTION_DAYS} days)`);
      }
    }
  } catch (e) {
    console.error('[Capture] Prune failed:', e);
  }
}

// Has this member produced a screenshot today by any route? Used to decide who
// still needs to be asked in Discord.
export function hasCaptureToday(userId: string, now = Date.now()): boolean {
  return readDay(todayKey(now)).some((r) => r.userId === userId);
}

export function capturedTodayIds(now = Date.now()): Set<string> {
  return new Set(readDay(todayKey(now)).map((r) => r.userId));
}

export function captureStats() {
  const dates = listDates();
  const today = todayKey();
  return {
    enabled: isConfigured(),
    capturesPerDay: CAPTURES_PER_DAY,
    retentionDays: RETENTION_DAYS,
    storedDays: dates.length,
    todayCount: readDay(today).length,
    latestDate: dates[0] || null,
    directory: CAPTURE_DIR,
  };
}
