import React, { useState, useEffect } from 'react';
import {
  Moon,
  Users,
  Bell,
  RefreshCw
} from 'lucide-react';
import { GuildMemberSummary } from '../types';

interface InactiveTabProps {
  onRefresh: () => void;
  onOpenSlashInactive: (days: number) => void;
}

export const InactiveTab: React.FC<InactiveTabProps> = ({
  onRefresh,
  onOpenSlashInactive,
}) => {
  const [thresholdDays, setThresholdDays] = useState(7);
  const [inactiveData, setInactiveData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [reminderStatus, setReminderStatus] = useState<Record<string, 'sending' | 'sent' | 'failed'>>({});

  const fetchInactive = async (days: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inactive?days=${days}`);
      const data = await res.json();
      setInactiveData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInactive(thresholdDays);
  }, [thresholdDays]);

  const handleSendReminder = async (member: GuildMemberSummary) => {
    setReminderStatus((prev) => ({ ...prev, [member.userId]: 'sending' }));
    try {
      const res = await fetch('/api/bot/send-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: member.userId,
          username: member.username,
          daysSinceLastActive: member.daysSinceLastActive,
        }),
      });
      const data = await res.json();
      setReminderStatus((prev) => ({ ...prev, [member.userId]: data.sent ? 'sent' : 'failed' }));
      if (!data.sent) {
        console.warn(`Reminder not sent to ${member.username}:`, data.error);
      }
    } catch (e) {
      console.error('Failed to send reminder:', e);
      setReminderStatus((prev) => ({ ...prev, [member.userId]: 'failed' }));
    } finally {
      setTimeout(() => {
        setReminderStatus((prev) => {
          const next = { ...prev };
          delete next[member.userId];
          return next;
        });
      }, 4000);
    }
  };

  const inactiveMembers: GuildMemberSummary[] = inactiveData?.inactiveMembers || [];
  const totalGuildMembers = inactiveData?.totalGuildMembers || 10;
  const inactivePct = Math.round((inactiveMembers.length / Math.max(1, totalGuildMembers)) * 100);

  return (
    <div className="space-y-8">
      {/* 01. Audit Header & Inactivity Threshold Controls */}
      <section className="bg-zinc-900 border border-zinc-800 p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-zinc-800 pb-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              01. Inactive Member Audit
            </h2>
            <p className="text-sm font-bold text-zinc-200 mt-1 uppercase tracking-tight">
              Identify & re-engage absent community members
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenSlashInactive(thresholdDays)}
              className="px-3 py-1.5 bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-black uppercase tracking-wider transition-colors"
            >
              Run /inactive in Discord →
            </button>
            <button
              onClick={() => fetchInactive(thresholdDays)}
              className="p-2 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-xs border border-zinc-800 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Threshold Slider & Quick Chips */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-4 font-mono">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
              INACTIVITY WINDOW:
            </span>
            <div className="flex items-center gap-1.5">
              {[3, 7, 14, 30, 60].map((d) => (
                <button
                  key={d}
                  onClick={() => setThresholdDays(d)}
                  className={`px-3 py-1 text-xs font-black uppercase transition-all ${
                    thresholdDays === d
                      ? 'bg-zinc-100 text-zinc-950'
                      : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                  }`}
                >
                  {d} DAYS
                </button>
              ))}
            </div>
          </div>

          <div className="text-xs text-zinc-400 font-mono">
            FILTER: <strong className="text-zinc-100">{thresholdDays}+ DAYS</strong> WITHOUT VOICE/STREAM ACTIVITY
          </div>
        </div>
      </section>

      {/* 02. Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-zinc-900 border border-zinc-800 p-5">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block font-mono">
            Inactive Members
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl sm:text-5xl font-black text-zinc-100 font-mono tracking-tighter">
              {inactiveMembers.length}
            </span>
            <span className="text-xs text-zinc-500 font-mono uppercase">OF {totalGuildMembers} MEMBERS</span>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-5">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block font-mono">
            Inactivity Ratio
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl sm:text-5xl font-black text-zinc-100 font-mono tracking-tighter">
              {inactivePct}%
            </span>
            <span className="text-xs text-zinc-500 font-mono uppercase">OF SERVER INACTIVE</span>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-5">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block font-mono">
            Active Members ({thresholdDays}d)
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl sm:text-5xl font-black text-emerald-400 font-mono tracking-tighter">
              {Math.max(0, totalGuildMembers - inactiveMembers.length)}
            </span>
            <span className="text-xs text-zinc-500 font-mono uppercase">PARTICIPATED</span>
          </div>
        </div>
      </div>

      {/* 03. Inactive Member List Table */}
      <section className="bg-zinc-900 border border-zinc-800 overflow-hidden">
        <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-baseline justify-between">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            03. Members With No Activity in Last {thresholdDays} Days ({inactiveMembers.length})
          </h3>
          <span className="text-[10px] font-mono text-zinc-500 uppercase">SORTED BY ABSENCE</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300 font-mono">
            <thead className="bg-zinc-950 text-zinc-500 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4">Member</th>
                <th className="py-3 px-4">Last Voice Activity</th>
                <th className="py-3 px-4">Days Inactive</th>
                <th className="py-3 px-4">Historical Total</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500 uppercase">
                    Scanning member session histories...
                  </td>
                </tr>
              ) : inactiveMembers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-400 uppercase">
                    🎉 Excellent! All server members have been active within {thresholdDays} days.
                  </td>
                </tr>
              ) : (
                inactiveMembers.map((m) => (
                  <tr key={m.userId} className="hover:bg-zinc-950/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={m.avatarUrl}
                          alt={m.username}
                          className="w-8 h-8 rounded-full border border-zinc-700 object-cover"
                        />
                        <div>
                          <span className="font-bold text-zinc-100 block">@{m.username}</span>
                          <span className="text-[10px] text-zinc-500">{m.userTag}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      {m.daysSinceLastActive > 90 ? (
                        <span className="text-zinc-600 italic">Never logged in voice</span>
                      ) : (
                        new Date(m.lastActiveTimestamp).toLocaleDateString()
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 text-xs font-black bg-zinc-950 text-zinc-300 border border-zinc-800">
                        {m.daysSinceLastActive} DAYS
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      {m.totalSessions} sessions ({Math.round(m.totalVoiceSeconds / 60)}m voice)
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleSendReminder(m)}
                        disabled={reminderStatus[m.userId] === 'sending'}
                        className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ml-auto transition-all disabled:opacity-60 ${
                          reminderStatus[m.userId] === 'sent'
                            ? 'bg-emerald-500 text-black'
                            : reminderStatus[m.userId] === 'failed'
                            ? 'bg-rose-500 text-black'
                            : 'bg-zinc-950 hover:bg-zinc-800 text-zinc-200 border border-zinc-800'
                        }`}
                      >
                        <Bell className="w-3.5 h-3.5" />
                        {reminderStatus[m.userId] === 'sending'
                          ? 'SENDING...'
                          : reminderStatus[m.userId] === 'sent'
                          ? 'PING SENT!'
                          : reminderStatus[m.userId] === 'failed'
                          ? 'NOT SENT (BOT OFFLINE)'
                          : 'SEND DISCORD PING'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
