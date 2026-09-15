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

export interface CaptureRecord {
  id: string;
  userId: string;
  username: string;
  date: string; // YYYY-MM-DD in office timezone
  takenAt: number; // epoch ms
  takenAtLocal: string; // HH:MM in office timezone
  channelName: string | null;
  bytes: number;
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
  const file = path.join(dayDir(date), `${id}.png`);
  if (!fs.existsSync(file)) return null;
  return { record, file };
}

// Decides whether the agent on this member's machine should capture now.
export function shouldCapture(params: {
  userId: string;
  isStreaming: boolean;
  now?: number;
}): { capture: boolean; reason: string; takenToday: number } {
  const now = params.now ?? Date.now();
  const date = todayKey(now);
  const mine = readDay(date).filter((r) => r.userId === params.userId);

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

export function saveCapture(params: {
  userId: string;
  username: string;
  channelName: string | null;
  agentHost: string | null;
  agentPlatform: string | null;
  image: Buffer;
  now?: number;
}): CaptureRecord {
  if (!params.image || params.image.length === 0) {
    throw new Error('Empty image body');
  }
  if (params.image.length > MAX_BYTES) {
    throw new Error(`Image too large (${params.image.length} bytes, max ${MAX_BYTES})`);
  }
  // PNG magic number — reject anything that isn't actually a PNG.
  const isPng =
    params.image.length > 8 &&
    params.image[0] === 0x89 &&
    params.image[1] === 0x50 &&
    params.image[2] === 0x4e &&
    params.image[3] === 0x47;
  if (!isPng) throw new Error('Body must be a PNG image');

  const now = params.now ?? Date.now();
  const date = todayKey(now);
  const id = `${date}_${params.userId}_${now}`;

  ensureDir(dayDir(date));
  fs.writeFileSync(path.join(dayDir(date), `${id}.png`), params.image);

  const record: CaptureRecord = {
    id,
    userId: params.userId,
    username: params.username,
    date,
    takenAt: now,
    takenAtLocal: localHhmm(now),
    channelName: params.channelName,
    bytes: params.image.length,
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
