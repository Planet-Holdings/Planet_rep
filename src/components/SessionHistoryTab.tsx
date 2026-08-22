import React, { useState, useEffect } from 'react';
import {
  Search,
  Mic,
  Video,
  Radio,
  FileSpreadsheet,
  FileCode
} from 'lucide-react';
import { MemberSession, ActivityType } from '../types';

interface SessionHistoryTabProps {
  onRefresh: () => void;
}

export const SessionHistoryTab: React.FC<SessionHistoryTabProps> = () => {
  const [sessions, setSessions] = useState<MemberSession[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ActivityType | 'all'>('all');
  const [searchUser, setSearchUser] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const buildFilterParams = () => {
    const params = new URLSearchParams();
    if (selectedActivity !== 'all') params.append('activityType', selectedActivity);
    if (startDate) params.append('startDate', new Date(startDate).toISOString());
    if (endDate) {
      // Treat the end date as inclusive of the whole day.
      const inclusiveEnd = new Date(endDate);
      inclusiveEnd.setHours(23, 59, 59, 999);
      params.append('endDate', inclusiveEnd.toISOString());
    }
    return params;
  };

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const params = buildFilterParams();
      params.append('limit', String(pageSize));
      params.append('offset', String(page * pageSize));

      const res = await fetch(`/api/sessions?${params.toString()}`);
      const data = await res.json();
      setSessions(data.sessions || []);
      setTotalCount(data.total || 0);
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    } finally {
      setLoading(false);
    }
  };

  // Pulls EVERY session matching the current filters (not just the page
  // currently on screen) by paging through the API internally, so exports
  // contain the full result set instead of whatever 20 rows are displayed.
  const fetchAllMatchingSessions = async (): Promise<MemberSession[]> => {
    const all: MemberSession[] = [];
    const fetchPageSize = 1000;
    let offset = 0;
    while (true) {
      const params = buildFilterParams();
      params.append('limit', String(fetchPageSize));
      params.append('offset', String(offset));

      const res = await fetch(`/api/sessions?${params.toString()}`);
      const data = await res.json();
      const batch: MemberSession[] = data.sessions || [];
      all.push(...batch);

      if (!data.hasMore || batch.length === 0) break;
      offset += fetchPageSize;
    }
    return all;
  };

  useEffect(() => {
    fetchSessions();
  }, [selectedActivity, startDate, endDate, page]);

  const formatSec = (sec: number) => {
    if (!sec || sec < 60) return `${Math.round(sec || 0)}s`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  const applySearchFilter = (list: MemberSession[]) =>
    list.filter((s) =>
      s.username.toLowerCase().includes(searchUser.toLowerCase()) ||
      s.channelName.toLowerCase().includes(searchUser.toLowerCase())
    );

  const filtered = applySearchFilter(sessions);

  const exportCSV = async () => {
    setExporting(true);
    try {
      const all = applySearchFilter(await fetchAllMatchingSessions());
      const headers = ['Session ID', 'User ID', 'Username', 'Activity Type', 'Channel', 'Start Time', 'End Time', 'Duration (Seconds)', 'Duration (Formatted)'];
      const rows = all.map((s) => [
        s.id,
        s.userId,
        s.username,
        s.activityType,
        `"${s.channelName}"`,
        new Date(s.startTime).toISOString(),
        s.endTime ? new Date(s.endTime).toISOString() : 'Ongoing',
        s.durationSeconds,
        `"${formatSec(s.durationSeconds)}"`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `discord_sessions_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error('Failed to export CSV:', e);
    } finally {
      setExporting(false);
    }
  };

  const exportJSON = async () => {
    setExporting(true);
    try {
      const all = applySearchFilter(await fetchAllMatchingSessions());
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(all, null, 2));
      const link = document.createElement('a');
      link.setAttribute('href', dataStr);
      link.setAttribute('download', `discord_sessions_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error('Failed to export JSON:', e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* 01. Header Controls */}
      <section className="bg-zinc-900 border border-zinc-800 p-5 flex flex-wrap items-center justify-between gap-4">
        {/* Search */}
        <div className="flex-1 min-w-[220px]">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="FILTER BY USER OR CHANNEL..."
              value={searchUser}
              onChange={(e) => setSearchUser(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono uppercase"
            />
          </div>
        </div>

        {/* Date Range */}
        <div className="flex items-center gap-2 bg-zinc-950 p-1.5 border border-zinc-800 font-mono">
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(0);
            }}
            className="bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
          <span className="text-zinc-600 text-xs uppercase">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(0);
            }}
            className="bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setPage(0);
              }}
              title="Clear date range"
              className="px-2 py-1 text-[10px] uppercase font-bold text-zinc-500 hover:text-zinc-200"
            >
              Clear
            </button>
          )}
        </div>

        {/* Activity Type Badges */}
        <div className="flex items-center gap-1.5 bg-zinc-950 p-1 border border-zinc-800 font-mono">
          {(['all', 'voice', 'video', 'stream'] as const).map((type) => (
            <button
              key={type}
              onClick={() => {
                setSelectedActivity(type);
                setPage(0);
              }}
              className={`px-3 py-1 text-xs font-black uppercase tracking-wider transition-all ${
                selectedActivity === type
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {type === 'all' ? 'ALL' : type}
            </button>
          ))}
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-950 hover:bg-zinc-800 disabled:opacity-40 text-zinc-200 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
          <button
            onClick={exportJSON}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-950 hover:bg-zinc-800 disabled:opacity-40 text-zinc-200 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
          >
            <FileCode className="w-3.5 h-3.5 text-zinc-100" />
            {exporting ? 'Exporting...' : 'Export JSON'}
          </button>
        </div>
      </section>

      {/* 02. Session Table */}
      <section className="bg-zinc-900 border border-zinc-800 overflow-hidden">
        <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            02. Session History Logs
          </h2>
          <span className="text-[10px] uppercase font-mono text-zinc-500">
            {totalCount} Total Persisted Records
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300 font-mono">
            <thead className="bg-zinc-950 text-zinc-500 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4">Member</th>
                <th className="py-3 px-4">Activity Type</th>
                <th className="py-3 px-4">Channel</th>
                <th className="py-3 px-4">Start Time</th>
                <th className="py-3 px-4">End Time</th>
                <th className="py-3 px-4 text-right">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500 uppercase">
                    Loading session records...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-600 uppercase">
                    No session logs found matching the filter.
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-zinc-950/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={s.avatarUrl}
                          alt={s.username}
                          className="w-7 h-7 rounded-full border border-zinc-700 object-cover"
                        />
                        <div>
                          <span className="font-bold text-zinc-100 block">@{s.username}</span>
                          <span className="text-[10px] text-zinc-500">{s.userTag}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {s.activityType === 'voice' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase">
                          <Mic className="w-3 h-3" />
                          VOICE
                        </span>
                      )}
                      {s.activityType === 'video' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/30 uppercase">
                          <Video className="w-3 h-3" />
                          VIDEO
                        </span>
                      )}
                      {s.activityType === 'stream' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 uppercase">
                          <Radio className="w-3 h-3" />
                          STREAM
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-zinc-300">
                      <span className="bg-zinc-950 px-2 py-0.5 text-[10px] border border-zinc-800">
                        #{s.channelName}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-400 text-[11px]">
                      {new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      <span className="block text-[10px] text-zinc-600">
                        {new Date(s.startTime).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-400 text-[11px]">
                      {s.endTime ? (
                        <>
                          {new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          <span className="block text-[10px] text-zinc-600">
                            {new Date(s.endTime).toLocaleDateString()}
                          </span>
                        </>
                      ) : (
                        <span className="text-emerald-400 font-bold uppercase">ONGOING</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-zinc-100">
                      {formatSec(s.durationSeconds)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400 font-mono">
          <span>
            SHOWING {Math.min(filtered.length, pageSize)} OF {totalCount} SESSIONS
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-zinc-200 border border-zinc-800 transition-colors uppercase font-bold text-[10px]"
            >
              PREVIOUS
            </button>
            <span className="text-zinc-300 font-bold">PAGE {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * pageSize >= totalCount}
              className="px-3 py-1 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-zinc-200 border border-zinc-800 transition-colors uppercase font-bold text-[10px]"
            >
              NEXT
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
