import React, { useState, useEffect, useCallback } from 'react';
import { Camera, RefreshCw, X, AlertTriangle, Monitor } from 'lucide-react';

interface CaptureRecord {
  id: string;
  userId: string;
  username: string;
  date: string;
  takenAt: number;
  takenAtLocal: string;
  channelName: string | null;
  bytes: number;
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

export const ScreenshotsTab: React.FC = () => {
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [stats, setStats] = useState<CaptureStats | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<CaptureRecord | null>(null);

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

  return (
    <div className="space-y-8">
      {/* 01. Status */}
      <section className="bg-zinc-900 border border-zinc-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              01. Workstation Screenshots
            </h2>
            <p className="text-sm font-bold text-zinc-200 mt-1 uppercase tracking-tight">
              One capture per rep per day, taken while they are screen-sharing
            </p>
          </div>
          <button
            onClick={() => load(selectedDate || undefined)}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {stats && !stats.enabled && (
          <div className="mt-4 flex items-start gap-2.5 p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Capture is disabled — set <strong>CAPTURE_TOKEN</strong> on the server, then install the
              agent from <code className="text-amber-200">agent/</code> on each rep's machine.
            </span>
          </div>
        )}

        {stats && stats.enabled && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center font-mono">
            <div className="p-3 bg-zinc-950 border border-zinc-800">
              <span className="text-[10px] font-bold text-zinc-500 uppercase block">Today</span>
              <span className="text-lg font-black text-zinc-100 block mt-0.5">{stats.todayCount}</span>
            </div>
            <div className="p-3 bg-zinc-950 border border-zinc-800">
              <span className="text-[10px] font-bold text-zinc-500 uppercase block">Days Stored</span>
              <span className="text-lg font-black text-zinc-100 block mt-0.5">{stats.storedDays}</span>
            </div>
            <div className="p-3 bg-zinc-950 border border-zinc-800">
              <span className="text-[10px] font-bold text-zinc-500 uppercase block">Per Rep / Day</span>
              <span className="text-lg font-black text-zinc-100 block mt-0.5">{stats.capturesPerDay}</span>
            </div>
            <div className="p-3 bg-zinc-950 border border-zinc-800">
              <span className="text-[10px] font-bold text-zinc-500 uppercase block">Retention</span>
              <span className="text-lg font-black text-zinc-100 block mt-0.5">{stats.retentionDays}d</span>
            </div>
          </div>
        )}
      </section>

      {/* 02. Date filter */}
      {dates.length > 0 && (
        <section className="bg-zinc-900 border border-zinc-800 p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">
            02. Day
          </h2>
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

      {/* 03. Grid */}
      <section>
        <div className="flex items-baseline justify-between mb-4 border-b border-zinc-800 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            03. Captures ({captures.length})
          </h2>
          <span className="text-[10px] uppercase font-mono text-zinc-500">Click to enlarge</span>
        </div>

        {captures.length === 0 ? (
          <div className="p-10 bg-zinc-900 border border-zinc-800 text-center">
            <Camera className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-xs text-zinc-500 uppercase font-mono">
              {loading ? 'Loading...' : 'No screenshots captured yet.'}
            </p>
            {!loading && stats?.enabled && (
              <p className="text-[10px] text-zinc-600 uppercase font-mono mt-2">
                The agent uploads one image per rep on the first day they screen-share.
              </p>
            )}
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
                  {lightbox.channelName ? ` • streaming in ${lightbox.channelName}` : ''}
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
