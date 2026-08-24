import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  Mic,
  Video,
  Radio,
  Trophy,
  Clock,
  Sparkles,
  X
} from 'lucide-react';
import { GuildMemberSummary, MemberSession } from '../types';

interface MembersStatsTabProps {
  members: GuildMemberSummary[];
  onOpenSlashStats: (userId: string, username: string) => void;
}

export const MembersStatsTab: React.FC<MembersStatsTabProps> = ({
  members,
  onOpenSlashStats,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [timeframe, setTimeframe] = useState<'all' | 'daily' | 'weekly' | 'monthly'>('all');
  const [selectedMember, setSelectedMember] = useState<GuildMemberSummary | null>(null);
  const [userStatsDetail, setUserStatsDetail] = useState<any | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Per-member totals for the selected timeframe, keyed by userId. The
  // `members` prop is always all-time, so the grid cards need their own
  // fetch whenever the timeframe toggle changes.
  const [timeframeStats, setTimeframeStats] = useState<Record<string, {
    totalVoiceSeconds: number;
    totalVideoSeconds: number;
    totalStreamSeconds: number;
    sessionCount: number;
  }>>({});
  const [isLoadingGrid, setIsLoadingGrid] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadTimeframeStats = async () => {
      if (timeframe === 'all') {
        // The `members` prop is already all-time, no extra fetch needed.
        if (!cancelled) setTimeframeStats({});
        return;
      }
      setIsLoadingGrid(true);
      try {
        const res = await fetch(`/api/leaderboard?timeframe=${timeframe}`);
        const data = await res.json();
        const map: Record<string, { totalVoiceSeconds: number; totalVideoSeconds: number; totalStreamSeconds: number; sessionCount: number }> = {};
        for (const entry of data.leaderboard || []) {
          const userId = entry.user?.userId;
          if (!userId) continue;
          map[userId] = {
            totalVoiceSeconds: entry.totalVoiceSeconds || 0,
            totalVideoSeconds: entry.totalVideoSeconds || 0,
            totalStreamSeconds: entry.totalStreamSeconds || 0,
            sessionCount: entry.sessionCount || 0,
          };
        }
        if (!cancelled) setTimeframeStats(map);
      } catch (e) {
        console.error('Failed to load timeframe stats:', e);
      } finally {
        if (!cancelled) setIsLoadingGrid(false);
      }
    };

    loadTimeframeStats();
    return () => {
      cancelled = true;
    };
  }, [timeframe]);

  const formatSec = (sec: number) => {
    if (!sec || sec < 60) return `${Math.round(sec || 0)}s`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const filteredMembers = members.filter((m) =>
    m.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.userTag.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const loadUserDetails = async (member: GuildMemberSummary) => {
    setSelectedMember(member);
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/stats/${member.userId}?timeframe=${timeframe}`);
      const data = await res.json();
      setUserStatsDetail(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* 01. Search & Timeframe Filter Bar */}
      <section className="bg-zinc-900 border border-zinc-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1 min-w-[260px]">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="SEARCH MEMBER BY USERNAME OR TAG..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono uppercase"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
              TIMEFRAME:
            </span>
            {(['all', 'weekly', 'monthly', 'daily'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTimeframe(t)}
                className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-all ${
                  timeframe === t
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                }`}
              >
                {t === 'all' ? 'All Time' : t === 'weekly' ? '7 Days' : t === 'monthly' ? '30 Days' : '24 Hours'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 02. Member Cards Grid */}
      <section>
        <div className="flex items-baseline justify-between mb-4 border-b border-zinc-800 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            02. Member Activity Directory ({filteredMembers.length})
          </h2>
          <span className="text-[10px] uppercase font-mono text-zinc-500">
            {isLoadingGrid ? 'Loading timeframe stats...' : 'Voice / Video / Stream Split'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredMembers.map((m, idx) => {
            const stats = timeframe === 'all' ? null : timeframeStats[m.userId];
            const voiceSec = stats ? stats.totalVoiceSeconds : m.totalVoiceSeconds;
            const videoSec = stats ? stats.totalVideoSeconds : m.totalVideoSeconds;
            const streamSec = stats ? stats.totalStreamSeconds : m.totalStreamSeconds;
            const sessionCount = stats ? stats.sessionCount : m.totalSessions;
            const totalSec = voiceSec + videoSec + streamSec;
            const vPct = totalSec > 0 ? Math.round((voiceSec / totalSec) * 100) : 0;
            const vidPct = totalSec > 0 ? Math.round((videoSec / totalSec) * 100) : 0;
            const strPct = totalSec > 0 ? Math.round((streamSec / totalSec) * 100) : 0;

            return (
              <div
                key={m.userId}
                className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 p-5 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Member Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={m.avatarUrl}
                        alt={m.username}
                        className="w-11 h-11 rounded-full border border-zinc-700 object-cover"
                      />
                      <div>
                        <h4 className="text-sm font-black uppercase text-zinc-100 font-mono tracking-tight">
                          @{m.username}
                        </h4>
                        <p className="text-[11px] font-mono text-zinc-500">{m.userTag}</p>
                      </div>
                    </div>

                    {m.isCurrentlyActive ? (
                      <span className="px-2 py-0.5 text-[9px] font-black bg-emerald-500 text-black uppercase">
                        ONLINE
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">
                        {m.daysSinceLastActive === 0 ? 'Today' : `${m.daysSinceLastActive}d ago`}
                      </span>
                    )}
                  </div>

                  {/* 3 Metric Breakdown Box */}
                  <div className="grid grid-cols-3 gap-2 py-3 px-3 bg-zinc-950 border border-zinc-800 text-center mb-4">
                    <div>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block font-mono">
                        Voice
                      </span>
                      <span className="text-xs font-black text-emerald-400 mt-0.5 block font-mono">
                        {formatSec(voiceSec)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block font-mono">
                        Video
                      </span>
                      <span className="text-xs font-black text-sky-400 mt-0.5 block font-mono">
                        {formatSec(videoSec)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block font-mono">
                        Stream
                      </span>
                      <span className="text-xs font-black text-rose-400 mt-0.5 block font-mono">
                        {formatSec(streamSec)}
                      </span>
                    </div>
                  </div>

                  {/* Activity Ratio Bar */}
                  {totalSec > 0 && (
                    <div className="space-y-1.5 mb-4">
                      <div className="flex h-2 bg-zinc-950 border border-zinc-800 overflow-hidden">
                        <div style={{ width: `${vPct}%` }} className="bg-emerald-500" title={`Voice: ${vPct}%`} />
                        <div style={{ width: `${vidPct}%` }} className="bg-sky-400" title={`Video: ${vidPct}%`} />
                        <div style={{ width: `${strPct}%` }} className="bg-rose-500" title={`Stream: ${strPct}%`} />
                      </div>
                      <div className="flex justify-between text-[10px] text-zinc-500 font-mono uppercase font-bold">
                        <span>Total: {formatSec(totalSec)}</span>
                        <span>{sessionCount} sessions</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-zinc-800">
                  <button
                    onClick={() => loadUserDetails(m)}
                    className="flex-1 py-2 px-3 bg-zinc-950 hover:bg-zinc-800 text-zinc-200 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
                  >
                    View Breakdown
                  </button>
                  <button
                    onClick={() => onOpenSlashStats(m.userId, m.username)}
                    className="py-2 px-3 bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-black uppercase tracking-wider transition-colors flex items-center gap-1"
                    title="Run /stats in Discord simulator"
                  >
                    /stats
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Member Details Modal */}
      {selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 max-w-xl w-full p-6 space-y-6 shadow-2xl relative">
            <button
              onClick={() => setSelectedMember(null)}
              className="absolute top-4 right-4 p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Modal Header */}
            <div className="flex items-center gap-4 border-b border-zinc-800 pb-4">
              <img
                src={selectedMember.avatarUrl}
                alt={selectedMember.username}
                className="w-14 h-14 rounded-full border-2 border-zinc-100 object-cover shadow-md"
              />
              <div>
                <h3 className="text-xl font-black uppercase text-zinc-100 font-mono tracking-tight">
                  @{selectedMember.username}
                </h3>
                <p className="text-xs text-zinc-400 font-mono">
                  Tag: {selectedMember.userTag} • User ID: <code className="text-zinc-300 font-mono">{selectedMember.userId}</code>
                </p>
              </div>
            </div>

            {isLoadingDetail ? (
              <div className="py-8 text-center text-xs font-mono uppercase text-zinc-500">
                Loading session breakdown from database...
              </div>
            ) : (
              <div className="space-y-4">
                {/* 3 Metric Cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-4 bg-zinc-900 border border-zinc-800 text-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 block font-mono">
                      Voice Time
                    </span>
                    <span className="text-lg font-black text-zinc-100 mt-1 block font-mono">
                      {formatSec(userStatsDetail?.totalVoiceSeconds || selectedMember.totalVoiceSeconds)}
                    </span>
                  </div>
                  <div className="p-4 bg-zinc-900 border border-zinc-800 text-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-sky-400 block font-mono">
                      Video Calls
                    </span>
                    <span className="text-lg font-black text-zinc-100 mt-1 block font-mono">
                      {formatSec(userStatsDetail?.totalVideoSeconds || selectedMember.totalVideoSeconds)}
                    </span>
                  </div>
                  <div className="p-4 bg-zinc-900 border border-zinc-800 text-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-rose-400 block font-mono">
                      Screen Share
                    </span>
                    <span className="text-lg font-black text-zinc-100 mt-1 block font-mono">
                      {formatSec(userStatsDetail?.totalStreamSeconds || selectedMember.totalStreamSeconds)}
                    </span>
                  </div>
                </div>

                {/* Recent Session Logs */}
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                    Recent Activity Logs
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {userStatsDetail?.recentSessions?.length === 0 ? (
                      <p className="text-xs text-zinc-600 font-mono uppercase py-3 text-center">No recent sessions found.</p>
                    ) : (
                      userStatsDetail?.recentSessions?.map((s: MemberSession) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between p-2.5 bg-zinc-900 border border-zinc-800 text-xs font-mono"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold uppercase text-zinc-200">
                              {s.activityType === 'voice' && '🔊 VOICE'}
                              {s.activityType === 'video' && '📹 VIDEO'}
                              {s.activityType === 'stream' && '🔴 STREAM'}
                            </span>
                            <span className="text-zinc-500">#{s.channelName}</span>
                          </div>
                          <span className="text-zinc-300 font-bold">
                            {formatSec(s.durationSeconds)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => {
                      onOpenSlashStats(selectedMember.userId, selectedMember.username);
                      setSelectedMember(null);
                    }}
                    className="px-4 py-2.5 bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-black uppercase tracking-wider transition-colors"
                  >
                    Test /stats Discord Embed →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
