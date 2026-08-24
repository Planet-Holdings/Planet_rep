import React, { useState } from 'react';
import {
  Search,
  Check,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  ClipboardList
} from 'lucide-react';
import { GuildMemberSummary, ReportResponse } from '../types';

interface ReportsTabProps {
  members: GuildMemberSummary[];
}

const toInputValue = (d: Date) => {
  // Local date, not UTC, so "today" doesn't shift a day depending on timezone.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Default report window: the current calendar month.
const defaultDates = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: toInputValue(start), end: toInputValue(now) };
};

const thisMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: toInputValue(start), end: toInputValue(now) };
};

const lastMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: toInputValue(start), end: toInputValue(end) };
};

export const ReportsTab: React.FC<ReportsTabProps> = ({ members }) => {
  const { start, end } = defaultDates();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(start);
  const [endDate, setEndDate] = useState(end);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredMembers = members.filter((m) =>
    m.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.userTag.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleMember = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const selectAllFiltered = () => {
    const ids = filteredMembers.map((m) => m.userId);
    setSelectedUserIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const clearSelection = () => setSelectedUserIds([]);

  const generateReport = async () => {
    if (!startDate || !endDate) {
      setError('Select a start and end date.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const inclusiveEnd = new Date(endDate);
      inclusiveEnd.setHours(23, 59, 59, 999);

      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: selectedUserIds,
          startDate: new Date(startDate).toISOString(),
          endDate: inclusiveEnd.toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate report');
      }
      const data: ReportResponse = await res.json();
      setReport(data);
    } catch (e: any) {
      console.error('Failed to generate report:', e);
      setError(e.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportReportCSV = () => {
    if (!report) return;
    const headers = [
      'User ID', 'Username', 'Days Active', 'Avg Login Time', 'Avg Logout Time',
      'Break/Lunch Hours', `Total Hours (of ${report.targetHours}h Target)`,
      `% of ${report.targetHours}h Target`, 'Sessions',
      'Voice Hours', 'Stream Hours', 'Video Hours',
      `% of ${report.targetHours}h Target Streamed`,
      `Paid Full (>= ${report.requiredStreamHours}h streamed)`
    ];
    const rows = report.results.map((r) => [
      r.userId,
      r.username,
      r.daysActive,
      r.avgLoginTime || 'N/A',
      r.avgLogoutTime || 'N/A',
      r.breakHours,
      r.totalHours,
      r.totalHoursPercentOfTarget,
      r.sessionCount,
      r.voiceHours,
      r.streamHours,
      r.videoHours,
      r.streamPercentOfTarget,
      r.paidFull ? 'YES' : 'NO',
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `payroll_report_${report.startDate.slice(0, 10)}_${report.endDate.slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8">
      {/* 01. Member Selection */}
      <section className="bg-zinc-900 border border-zinc-800 overflow-hidden">
        <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            01. Select Members
          </h2>
          <span className="text-[10px] uppercase font-mono text-zinc-500">
            {selectedUserIds.length} Selected
          </span>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
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
            <button
              onClick={selectAllFiltered}
              className="px-3 py-2 bg-zinc-950 hover:bg-zinc-800 text-zinc-200 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
            >
              Select All Shown
            </button>
            <button
              onClick={clearSelection}
              className="px-3 py-2 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
            >
              Clear
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto border border-zinc-800 divide-y divide-zinc-800/80">
            {filteredMembers.length === 0 ? (
              <div className="py-6 text-center text-zinc-600 uppercase text-xs font-mono">
                No members found.
              </div>
            ) : (
              filteredMembers.map((m) => {
                const isSelected = selectedUserIds.includes(m.userId);
                return (
                  <button
                    key={m.userId}
                    onClick={() => toggleMember(m.userId)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isSelected ? 'bg-zinc-100/5' : 'hover:bg-zinc-950/60'
                    }`}
                  >
                    <div className={`w-4 h-4 flex items-center justify-center border shrink-0 ${
                      isSelected ? 'bg-zinc-100 border-zinc-100' : 'border-zinc-700'
                    }`}>
                      {isSelected && <Check className="w-3 h-3 text-zinc-950" />}
                    </div>
                    <img
                      src={m.avatarUrl}
                      alt={m.username}
                      className="w-7 h-7 rounded-full border border-zinc-700 object-cover"
                    />
                    <div>
                      <span className="font-bold text-zinc-100 block text-xs">@{m.username}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">{m.userTag}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* 02. Date Range & Generate */}
      <section className="bg-zinc-900 border border-zinc-800 p-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">
          02. Report Window
        </h2>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={() => {
              const r = thisMonthRange();
              setStartDate(r.start);
              setEndDate(r.end);
            }}
            className="px-3 py-1.5 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
          >
            This Month
          </button>
          <button
            onClick={() => {
              const r = lastMonthRange();
              setStartDate(r.start);
              setEndDate(r.end);
            }}
            className="px-3 py-1.5 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
          >
            Last Month
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1.5">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 font-mono"
            />
          </div>
          <button
            onClick={generateReport}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-zinc-100 hover:bg-white disabled:opacity-40 text-zinc-950 text-xs font-black uppercase tracking-wider transition-colors"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
          {report && (
            <button
              onClick={exportReportCSV}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-950 hover:bg-zinc-800 text-zinc-200 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              Export CSV
            </button>
          )}
        </div>
        {error && (
          <p className="mt-3 text-xs text-rose-400 font-mono">{error}</p>
        )}
        <p className="mt-3 text-[10px] text-zinc-600 font-mono uppercase">
          Attendance target: 160 hrs (40hrs x 4 weeks) — full pay requires streaming at least 80% of that (128 hrs).
        </p>
        <p className="mt-1 text-[10px] text-zinc-700 font-mono uppercase">
          Login/logout are averaged from each day's first voice join and last voice leave. Break/lunch is time between voice sessions within that daily span.
        </p>
      </section>

      {/* 03. Results */}
      {report && (
        <section className="bg-zinc-900 border border-zinc-800 overflow-hidden">
          <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              03. Attendance Report
            </h2>
            <span className="text-[10px] uppercase font-mono text-zinc-500">
              {new Date(report.startDate).toLocaleDateString()} &rarr; {new Date(report.endDate).toLocaleDateString()}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300 font-mono">
              <thead className="bg-zinc-950 text-zinc-500 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Member</th>
                  <th className="py-3 px-4 text-right">Days Active</th>
                  <th className="py-3 px-4 text-right">Avg Login</th>
                  <th className="py-3 px-4 text-right">Avg Logout</th>
                  <th className="py-3 px-4 text-right">Break/Lunch</th>
                  <th className="py-3 px-4 text-right">Total Hours</th>
                  <th className="py-3 px-4 text-right">% of Target</th>
                  <th className="py-3 px-4 text-right">Sessions</th>
                  <th className="py-3 px-4 text-right">Voice Hours</th>
                  <th className="py-3 px-4 text-right">Screen Active (Stream) Hours</th>
                  <th className="py-3 px-4 text-right">Video Hours</th>
                  <th className="py-3 px-4 text-right">% of Target Streamed</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {report.results.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-8 text-center text-zinc-600 uppercase">
                      No activity found for this selection and range.
                    </td>
                  </tr>
                ) : (
                  report.results.map((r) => (
                    <tr key={r.userId} className="hover:bg-zinc-950/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={r.avatarUrl}
                            alt={r.username}
                            className="w-7 h-7 rounded-full border border-zinc-700 object-cover"
                          />
                          <div>
                            <span className="font-bold text-zinc-100 block">@{r.username}</span>
                            <span className="text-[10px] text-zinc-500">{r.userTag}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-zinc-400">{r.daysActive}</td>
                      <td className="py-3 px-4 text-right text-zinc-300">{r.avgLoginTime || '—'}</td>
                      <td className="py-3 px-4 text-right text-zinc-300">{r.avgLogoutTime || '—'}</td>
                      <td className="py-3 px-4 text-right text-zinc-400">{r.breakHours.toFixed(1)}h</td>
                      <td className="py-3 px-4 text-right font-black text-zinc-100">{r.totalHours.toFixed(1)}h</td>
                      <td className="py-3 px-4 text-right text-zinc-300">{r.totalHoursPercentOfTarget.toFixed(1)}%</td>
                      <td className="py-3 px-4 text-right text-zinc-400">{r.sessionCount}</td>
                      <td className="py-3 px-4 text-right text-zinc-200">{r.voiceHours.toFixed(1)}h</td>
                      <td className="py-3 px-4 text-right font-bold text-zinc-100">{r.streamHours.toFixed(1)}h</td>
                      <td className="py-3 px-4 text-right text-zinc-400">{r.videoHours.toFixed(1)}h</td>
                      <td className="py-3 px-4 text-right text-zinc-300">{r.streamPercentOfTarget.toFixed(1)}%</td>
                      <td className="py-3 px-4 text-right">
                        {r.paidFull ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase">
                            <CheckCircle2 className="w-3 h-3" />
                            Paid Full
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 uppercase">
                            <XCircle className="w-3 h-3" />
                            Below Threshold
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono uppercase">
            Target: {report.targetHours}h &bull; Required Stream Hours for Full Pay: {report.requiredStreamHours}h ({report.requiredStreamPercent}%)
          </div>
        </section>
      )}
    </div>
  );
};
