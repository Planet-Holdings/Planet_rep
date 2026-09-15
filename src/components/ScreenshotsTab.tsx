import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Camera,
  RefreshCw,
  X,
  Monitor,
  Upload,
  Radio,
  ExternalLink,
  Trash2,
  Check
} from 'lucide-react';
import { GuildMemberSummary } from '../types';

interface CaptureRecord {
  id: string;
  userId: string;
  username: string;
  date: string;
  takenAt: number;
  takenAtLocal: string;
  channelName: string | null;
  bytes: number;
  ext: string;
  source: 'agent' | 'manual';
  note: string | null;
  agentHost: string | null;
  agentPlatform: string | null;
}

interface CaptureStats {
  enabled: boolean;
  capturesPerDay: number;
  retentionDays: number;
  storedDays: number;
  todayCount: number;
  latestDate: string | null;
  directory: string;
}

interface StreamCheckRow {
  userId: string;
  username: string;
  channelId?: string;
  channelName?: string;
}

interface StreamCheck {
  live: StreamCheckRow[];
  inVoiceNotLive: StreamCheckRow[];
  notOnline: StreamCheckRow[];
  localTime: string;
  posted: boolean;
}

interface ScreenshotsTabProps {
  members: GuildMemberSummary[];
  guildId?: string;
}

const fmtDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const ScreenshotsTab: React.FC<ScreenshotsTabProps> = ({ members, guildId }) => {
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [stats, setStats] = useState<CaptureStats | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<CaptureRecord | null>(null);

  const [streamCheck, setStreamCheck] = useState<StreamCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const [uploadFor, setUploadFor] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (date?: string) => {
    setLoading(true);
    try {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      const res = await fetch(`/api/capture/list${qs}`);
      const data = await res.json();
      setCaptures(data.captures || []);
      setDates(data.dates || []);
      setStats(data.stats || null);
    } catch (e) {
      console.error('Failed to load captures:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedDate || undefined);
  }, [load, selectedDate]);

  // Who is live right now, so you know whose stream to open and screenshot.
  const runStreamCheck = useCallback(async (post: boolean) => {
    setChecking(true);
    try {
      const res = await fetch('/api/stream-check/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stream check failed');
      setStreamCheck(data);
      if (!uploadFor && data.live?.length > 0) setUploadFor(data.live[0].userId);
    } catch (e: any) {
      console.error(e);
      setUploadMsg(e.message || 'Stream check failed');
    } finally {
      setChecking(false);
    }
  }, [uploadFor]);

  useEffect(() => {
    runStreamCheck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadImage = useCallback(async (file: File | Blob, userId: string) => {
    if (!userId) {
      setUploadMsg('Pick which rep this screenshot is of first.');
      return;
    }
    setUploading(true);
    setUploadMsg(null);
    try {
      const res = await fetch(`/api/capture/manual?userId=${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setUploadMsg(`Saved at ${fmt12(data.takenAtLocal)}.`);
      setSelectedDate('');
      await load();
    } catch (e: any) {
      setUploadMsg(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [load]);

  // Paste a screenshot straight from the clipboard (Cmd/Ctrl+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
      if (!item) return;
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        uploadImage(file, uploadFor);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [uploadFor, uploadImage]);

  const remove = async (id: string) => {
    try {
      await fetch(`/api/capture/${id}`, { method: 'DELETE' });
      setLightbox(null);
      await load(selectedDate || undefined);
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const pickerOptions = React.useMemo(() => {
    const live = streamCheck?.live || [];
    const liveIds = new Set(live.map((l) => l.userId));
    const rest = members
      .filter((m) => !liveIds.has(m.userId))
      .map((m) => ({ userId: m.userId, username: m.username, live: false }));
    return [
      ...live.map((l) => ({ userId: l.userId, username: l.username, live: true })),
      ...rest,
    ];
  }, [streamCheck, members]);

  return (
    <div className="space-y-8">
      {/* 01. Who is live right now */}
      <section className="bg-zinc-900 border border-zinc-800 overflow-hidden">
        <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              01. Live Right Now
            </h2>
            <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
              Discord never gives a bot the video, so open the stream and screenshot it below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => runStreamCheck(false)}
              disabled={checking}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-950 hover:bg-zinc-800 disabled:opacity-40 text-zinc-300 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => runStreamCheck(true)}
              disabled={checking}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-100 hover:bg-white disabled:opacity-40 text-zinc-950 text-xs font-black uppercase tracking-wider transition-colors"
              title="Post this list to the Discord log channel"
            >
              <Radio className="w-3.5 h-3.5" />
              Post to Discord
            </button>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2">
              🔴 Streaming ({streamCheck?.live.length || 0})
            </h3>
            <div className="space-y-1.5">
              {(streamCheck?.live.length || 0) === 0 ? (
                <p className="text-[11px] text-zinc-600 font-mono uppercase">Nobody live.</p>
              ) : (
                streamCheck!.live.map((r) => (
                  <div key={r.userId} className="flex items-center justify-between gap-2 p-2 bg-zinc-950 border-l-2 border-emerald-500">
                    <span className="text-xs font-bold text-zinc-100 font-mono truncate">@{r.username}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {guildId && r.channelId && (
                        <a
                          href={`https://discord.com/channels/${guildId}/${r.channelId}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open their channel in Discord"
                          className="p-1 text-zinc-400 hover:text-zinc-100"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        onClick={() => setUploadFor(r.userId)}
                        title="Upload a screenshot for this rep"
                        className={`px-1.5 py-0.5 text-[9px] font-black uppercase border transition-colors ${
                          uploadFor === r.userId
                            ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-100'
                        }`}
                      >
                        {uploadFor === r.userId ? 'Selected' : 'Select'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-2">
              🔇 In voice, not streaming ({streamCheck?.inVoiceNotLive.length || 0})
            </h3>
            <div className="space-y-1.5">
              {(streamCheck?.inVoiceNotLive.length || 0) === 0 ? (
                <p className="text-[11px] text-zinc-600 font-mono uppercase">None.</p>
              ) : (
                streamCheck!.inVoiceNotLive.map((r) => (
                  <div key={r.userId} className="p-2 bg-zinc-950 border-l-2 border-amber-500">
                    <span className="text-xs font-bold text-zinc-200 font-mono truncate block">@{r.username}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">{r.channelName}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
              ⚪ Not in voice ({streamCheck?.notOnline.length || 0})
            </h3>
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {(streamCheck?.notOnline.length || 0) === 0 ? (
                <p className="text-[11px] text-zinc-600 font-mono uppercase">Everyone is online.</p>
              ) : (
                streamCheck!.notOnline.map((r) => (
                  <p key={r.userId} className="text-[11px] text-zinc-500 font-mono truncate">@{r.username}</p>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 02. Upload */}
      <section className="bg-zinc-900 border border-zinc-800 p-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">
          02. Add a Screenshot
        </h2>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5">
              Which rep is this of?
            </label>
            <select
              value={uploadFor}
              onChange={(e) => setUploadFor(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 font-mono font-bold"
            >
              <option value="">— select a member —</option>
              {pickerOptions.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.live ? '🔴 ' : ''}@{m.username}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading || !uploadFor}
            className="flex items-center gap-1.5 px-4 py-2 bg-zinc-100 hover:bg-white disabled:opacity-40 text-zinc-950 text-xs font-black uppercase tracking-wider transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Uploading...' : 'Choose Image'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f, uploadFor);
              e.target.value = '';
            }}
          />
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) uploadImage(f, uploadFor);
          }}
          className={`border-2 border-dashed p-8 text-center transition-colors ${
            dragOver ? 'border-zinc-400 bg-zinc-950' : 'border-zinc-800 bg-zinc-950/50'
          }`}
        >
          <Camera className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
          <p className="text-xs text-zinc-400 font-mono uppercase">
            Drag an image here, or press <strong className="text-zinc-200">Cmd/Ctrl + V</strong> to paste
          </p>
          <p className="text-[10px] text-zinc-600 font-mono uppercase mt-1">
            Open the rep's stream in Discord, take a screenshot, paste it here. PNG or JPEG.
          </p>
        </div>

        {uploadMsg && (
          <p className="mt-3 text-xs font-mono text-zinc-300 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            {uploadMsg}
          </p>
        )}

        {stats && (
          <p className="mt-3 text-[10px] text-zinc-600 font-mono uppercase">
            {stats.todayCount} stored today · {stats.storedDays} days kept · auto-deleted after {stats.retentionDays} days
            {!stats.enabled && ' · agent capture disabled (CAPTURE_TOKEN unset)'}
          </p>
        )}
      </section>

      {/* 03. Date filter */}
      {dates.length > 0 && (
        <section className="bg-zinc-900 border border-zinc-800 p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">03. Day</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedDate('')}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                selectedDate === ''
                  ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                  : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
              }`}
            >
              Recent
            </button>
            {dates.slice(0, 14).map((d) => (
              <button
                key={d}
                onClick={() => setSelectedDate(d)}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                  selectedDate === d
                    ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                    : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
                }`}
              >
                {fmtDate(d)}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 04. Grid */}
      <section>
        <div className="flex items-baseline justify-between mb-4 border-b border-zinc-800 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            04. Screenshots ({captures.length})
          </h2>
          <span className="text-[10px] uppercase font-mono text-zinc-500">Click to enlarge</span>
        </div>

        {captures.length === 0 ? (
          <div className="p-10 bg-zinc-900 border border-zinc-800 text-center">
            <Camera className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-xs text-zinc-500 uppercase font-mono">
              {loading ? 'Loading...' : 'No screenshots yet.'}
            </p>
            <p className="text-[10px] text-zinc-600 uppercase font-mono mt-2">
              Pick a rep above, open their stream in Discord, and paste a screenshot.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {captures.map((c) => (
              <button
                key={c.id}
                onClick={() => setLightbox(c)}
                className="bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors text-left overflow-hidden group"
              >
                <div className="bg-zinc-950 border-b border-zinc-800 aspect-video overflow-hidden">
                  <img
                    src={`/api/capture/image/${c.id}`}
                    alt={`${c.username} on ${c.date}`}
                    loading="lazy"
                    className="w-full h-full object-cover object-top group-hover:opacity-90 transition-opacity"
                  />
                </div>
                <div className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase text-zinc-100 font-mono truncate">
                      @{c.username}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                      {fmt12(c.takenAtLocal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-zinc-500 uppercase">
                    <span className="truncate">{c.channelName || 'Unknown channel'}</span>
                    <span className="shrink-0">{fmtDate(c.date)}</span>
                  </div>
                  <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase border ${
                    c.source === 'agent'
                      ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                  }`}>
                    {c.source === 'agent' ? 'Auto (agent)' : 'Manual'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div
            className="bg-zinc-950 border border-zinc-800 max-w-6xl w-full max-h-full overflow-auto relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between gap-4 p-4 bg-zinc-950 border-b border-zinc-800">
              <div className="min-w-0">
                <h3 className="text-sm font-black uppercase text-zinc-100 font-mono truncate">
                  @{lightbox.username}
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono truncate">
                  {fmtDate(lightbox.date)} at {fmt12(lightbox.takenAtLocal)}
                  {lightbox.channelName ? ` • ${lightbox.channelName}` : ''}
                  {lightbox.source === 'agent' ? ' • auto' : ' • manual'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lightbox.agentPlatform && (
                  <span className="hidden sm:flex items-center gap-1 text-[10px] font-mono text-zinc-500 uppercase">
                    <Monitor className="w-3 h-3" />
                    {lightbox.agentPlatform}
                    {lightbox.agentHost ? ` / ${lightbox.agentHost}` : ''}
                  </span>
                )}
                <button
                  onClick={() => remove(lightbox.id)}
                  title="Delete this screenshot"
                  className="p-2 bg-zinc-900 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-400 border border-zinc-800 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setLightbox(null)}
                  className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <img
              src={`/api/capture/image/${lightbox.id}`}
              alt={`${lightbox.username} full screenshot`}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
};
