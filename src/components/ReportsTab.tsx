import React, { useState } from 'react';
import {
  Search,
  Check,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  CalendarDays
} from 'lucide-react';
import { GuildMemberSummary, ReportResponse, ReportPersonResult, DayResult, DayStatus } from '../types';

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

// Monday of the week containing `d`.
const mondayOf = (d: Date) => {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (day.getDay() + 6) % 7; // Mon=0 ... Sun=6
  day.setDate(day.getDate() - offset);
  return day;
};

const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

type QuickRange = { label: string; range: () => { start: string; end: string } };

const QUICK_RANGES: QuickRange[] = [
  {
    label: 'Today',
    range: () => {
      const now = new Date();
      return { start: toInputValue(now), end: toInputValue(now) };
    },
  },
  {
    label: 'This Week',
    range: () => {
      const now = new Date();
      return { start: toInputValue(mondayOf(now)), end: toInputValue(now) };
    },
  },
  {
    label: 'Last Week',
    range: () => {
      const lastMonday = addDays(mondayOf(new Date()), -7);
      return { start: toInputValue(lastMonday), end: toInputValue(addDays(lastMonday, 6)) };
    },
  },
  {
    label: 'Last 2 Weeks',
    range: () => {
      const thisMonday = mondayOf(new Date());
      return { start: toInputValue(addDays(thisMonday, -14)), end: toInputValue(addDays(thisMonday, -1)) };
    },
  },
  {
    label: 'This Month',
    range: () => {
      const now = new Date();
      return { start: toInputValue(new Date(now.getFullYear(), now.getMonth(), 1)), end: toInputValue(now) };
    },
  },
  {
    label: 'Last Month',
    range: () => {
      const now = new Date();
      return {
        start: toInputValue(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        end: toInputValue(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
];

// "09:07" -> "9:07 AM"; passes through "now" and null.
const fmt12 = (hhmm: string | null | undefined) => {
  if (!hhmm) return '—';
  if (hhmm === 'now') return 'now';
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

const fmtMinutes = (min: number) => {
  if (!min) return '0m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const fmtDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const STATUS_LABEL: Record<DayStatus, string> = {
  on_time: 'On Time',
  late: 'Late',
  left_early: 'Left Early',
  late_and_left_early: 'Late + Left Early',
};

const STATUS_CLASS: Record<DayStatus, string> = {
  on_time: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  late: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  left_early: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  late_and_left_early: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
};

const csvEscape = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadCsv = (filename: string, headers: string[], rows: (string | number | null | undefined)[][]) => {
  const content = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const ReportsTab: React.FC<ReportsTabProps> = ({ members }) => {
  const initial = QUICK_RANGES[1].range(); // This Week
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const toggleExpanded = (userId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const generateReport = async () => {
    if (!startDate || !endDate) {
      setError('Select a start and end date.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Plain calendar dates: the server interprets them in the office timezone.
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: selectedUserIds, startDate, endDate }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate report');
      }
      const data: ReportResponse = await res.json();
      setReport(data);
      setExpanded(new Set());
    } catch (e: any) {
      console.error('Failed to generate report:', e);
      setError(e.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const rangeSlug = (r: ReportResponse) => `${startDate}_${endDate}`;

  const exportSummaryCSV = () => {
    if (!report) return;
    const headers = [
      'User ID', 'Username', 'Days Active', 'Workdays Missed',
      `Avg Clock In (${report.timezone})`, `Avg Clock Out (${report.timezone})`,
      'Avg Late (min)', 'Late Days', 'Avg Early Leave (min)', 'Early Leave Days', 'On-Time Days',
      'Lunch Hours', 'Break Hours', 'Worked Hours (in voice)',
      `Total Hours (of ${report.targetHours}h target)`, '% of Target',
      'Sessions', 'Voice Hours', 'Stream Hours', 'Video Hours',
      '% of Target Streamed', `Paid Full (>= ${report.requiredStreamHours}h streamed)`,
    ];
    const rows = report.results.map((r) => [
      r.userId, r.username, r.daysActive, r.workdaysMissed,
      r.avgClockIn || 'N/A', r.avgClockOut || 'N/A',
      r.avgLateMinutes, r.lateDays, r.avgEarlyLeaveMinutes, r.earlyLeaveDays, r.onTimeDays,
      r.lunchHours, r.breakHours, r.workedHours,
      r.totalHours, r.totalHoursPercentOfTarget,
      r.sessionCount, r.voiceHours, r.streamHours, r.videoHours,
      r.streamPercentOfTarget, r.paidFull ? 'YES' : 'NO',
    ]);
    downloadCsv(`payroll_summary_${rangeSlug(report)}.csv`, headers, rows);
  };

  const exportDailyCSV = () => {
    if (!report) return;
    const headers = [
      'User ID', 'Username', 'Date', 'Weekday', 'Workday',
      `Clock In (${report.timezone})`, `Clock Out (${report.timezone})`, 'Still In Voice',
      'Lunch (min)', 'Breaks (min)', 'Worked Hours (in voice)', 'Span Hours (in to out)', 'Stream Hours',
      'Late (min)', 'Early Leave (min)', 'Status',
    ];
    const rows: (string | number)[][] = [];
    for (const r of report.results) {
      for (const d of r.days) {
        rows.push([
          r.userId, r.username, d.date, d.weekday, d.isWorkday ? 'YES' : 'NO',
          d.clockIn, d.clockOut, d.ongoing ? 'YES' : 'NO',
          d.lunchMinutes, d.breakMinutes, d.workedHours, d.spanHours, d.streamHours,
          d.lateMinutes, d.earlyLeaveMinutes, STATUS_LABEL[d.status],
        ]);
      }
    }
    downloadCsv(`attendance_daily_${rangeSlug(report)}.csv`, headers, rows);
  };

  const renderDayRows = (r: ReportPersonResult) => (
    <tr key={`${r.userId}-days`} className="bg-zinc-950/80">
      <td colSpan={13} className="px-4 pb-4 pt-2">
        {r.days.length === 0 ? (
          <p className="text-[10px] text-zinc-600 uppercase font-mono py-2">No voice activity in this window.</p>
        ) : (
          <div className="overflow-x-auto border border-zinc-800">
            <table className="w-full text-left text-[11px] text-zinc-300 font-mono">
              <thead className="bg-zinc-900 text-zinc-500 uppercase font-black text-[9px] tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3 text-right">Clock In</th>
                  <th className="py-2 px-3 text-right">Clock Out</th>
                  <th className="py-2 px-3 text-right">Lunch</th>
                  <th className="py-2 px-3 text-right">Breaks</th>
                  <th className="py-2 px-3 text-right">Worked</th>
                  <th className="py-2 px-3 text-right">In → Out</th>
                  <th className="py-2 px-3 text-right">Streamed</th>
                  <th className="py-2 px-3 text-right">Late</th>
                  <th className="py-2 px-3 text-right">Early Out</th>
                  <th className="py-2 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {r.days.map((d: DayResult) => (
                  <tr key={d.date} className={d.isWorkday ? '' : 'text-zinc-500'}>
                    <td className="py-1.5 px-3 whitespace-nowrap">
                      <span className="text-zinc-500 mr-1.5">{d.weekday}</span>
                      {fmtDate(d.date)}
                      {!d.isWorkday && <span className="ml-1.5 text-[9px] uppercase text-zinc-600">weekend</span>}
                    </td>
                    <td className="py-1.5 px-3 text-right whitespace-nowrap">{fmt12(d.clockIn)}</td>
                    <td className="py-1.5 px-3 text-right whitespace-nowrap">
                      {d.ongoing ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          in voice
                        </span>
                      ) : fmt12(d.clockOut)}
                    </td>
                    <td className="py-1.5 px-3 text-right">{fmtMinutes(d.lunchMinutes)}</td>
                    <td className="py-1.5 px-3 text-right">{fmtMinutes(d.breakMinutes)}</td>
                    <td className="py-1.5 px-3 text-right font-bold text-zinc-100">{d.workedHours.toFixed(1)}h</td>
                    <td className="py-1.5 px-3 text-right text-zinc-400">{d.spanHours.toFixed(1)}h</td>
                    <td className="py-1.5 px-3 text-right">{d.streamHours.toFixed(1)}h</td>
                    <td className={`py-1.5 px-3 text-right ${d.lateMinutes > report!.lateGraceMinutes ? 'text-amber-400' : 'text-zinc-500'}`}>
                      {d.lateMinutes > 0 ? `+${fmtMinutes(d.lateMinutes)}` : '—'}
                    </td>
                    <td className={`py-1.5 px-3 text-right ${d.earlyLeaveMinutes > report!.lateGraceMinutes ? 'text-amber-400' : 'text-zinc-500'}`}>
                      {d.earlyLeaveMinutes > 0 ? `-${fmtMinutes(d.earlyLeaveMinutes)}` : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold border uppercase ${STATUS_CLASS[d.status]}`}>
                        {STATUS_LABEL[d.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </td>
    </tr>
  );

  return (
    <div className="space-y-8">
      {/* 01. Member Selection */}
      <section className="bg-zinc-900 border border-zinc-800 overflow-hidden">
        <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            01. Select Members
          </h2>
          <span className="text-[10px] uppercase font-mono text-zinc-500">
            {selectedUserIds.length === 0 ? 'All members with activity' : `${selectedUserIds.length} Selected`}
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
          {QUICK_RANGES.map((q) => (
            <button
              key={q.label}
              onClick={() => {
                const r = q.range();
                setStartDate(r.start);
                setEndDate(r.end);
              }}
              className="px-3 py-1.5 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
            >
              {q.label}
            </button>
          ))}
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
            <>
              <button
                onClick={exportSummaryCSV}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-950 hover:bg-zinc-800 text-zinc-200 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                Export Summary
              </button>
              <button
                onClick={exportDailyCSV}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-950 hover:bg-zinc-800 text-zinc-200 text-xs font-bold uppercase tracking-wider border border-zinc-800 transition-colors"
              >
                <CalendarDays className="w-3.5 h-3.5 text-sky-400" />
                Export Daily
              </button>
            </>
          )}
        </div>
        {error && (
          <p className="mt-3 text-xs text-rose-400 font-mono">{error}</p>
        )}
        <p className="mt-3 text-[10px] text-zinc-600 font-mono uppercase">
          Target scales with the window: working days (Mon–Fri) × 8h — 1 week = 40h, 2 weeks = 80h, 4 weeks = 160h. Full pay requires streaming at least 80% of the target.
        </p>
        <p className="mt-1 text-[10px] text-zinc-700 font-mono uppercase">
          Clock in = first voice join of the day, clock out = last voice leave. Lunch = longest gap between voice sessions (20m+); other gaps count as breaks. Late / early-out compare against the 9:00 AM – 6:30 PM Miami (ET) schedule.
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
              {fmtDate(startDate)} &rarr; {fmtDate(endDate)} &bull; {report.workingDays} working days
            </span>
          </div>

          <div className="px-4 py-3 bg-zinc-950/60 border-b border-zinc-800 flex flex-wrap gap-x-6 gap-y-1 text-[10px] font-mono uppercase text-zinc-400">
            <span>Target: <strong className="text-zinc-100">{report.targetHours}h</strong> ({report.workingDays} days × {report.hoursPerDay}h)</span>
            <span>Full pay: <strong className="text-zinc-100">≥ {report.requiredStreamHours}h streamed</strong> ({report.requiredStreamPercent}%)</span>
            <span>Schedule: <strong className="text-zinc-100">{fmt12(report.schedule.start)} – {fmt12(report.schedule.end)}</strong> {report.timezone.replace('America/', '')}</span>
            <span>Grace: {report.lateGraceMinutes}m</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300 font-mono">
              <thead className="bg-zinc-950 text-zinc-500 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Member</th>
                  <th className="py-3 px-4 text-right">Days</th>
                  <th className="py-3 px-4 text-right">Avg Clock In</th>
                  <th className="py-3 px-4 text-right">Avg Clock Out</th>
                  <th className="py-3 px-4 text-right">Late</th>
                  <th className="py-3 px-4 text-right">Early Out</th>
                  <th className="py-3 px-4 text-right">Lunch</th>
                  <th className="py-3 px-4 text-right">Breaks</th>
                  <th className="py-3 px-4 text-right">Total Hours</th>
                  <th className="py-3 px-4 text-right">% of Target</th>
                  <th className="py-3 px-4 text-right">Streamed</th>
                  <th className="py-3 px-4 text-right">% Streamed</th>
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
                  report.results.flatMap((r) => {
                    const isOpen = expanded.has(r.userId);
                    const rows = [
                      <tr
                        key={r.userId}
                        onClick={() => toggleExpanded(r.userId)}
                        className="hover:bg-zinc-950/60 transition-colors cursor-pointer"
                        title="Click to show the day-by-day breakdown"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
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
                        <td className="py-3 px-4 text-right text-zinc-400 whitespace-nowrap">
                          {r.daysActive}
                          {r.workdaysMissed > 0 && (
                            <span className="ml-1 text-[10px] text-rose-400" title="Working days with no voice activity">
                              (-{r.workdaysMissed})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-zinc-300 whitespace-nowrap">{fmt12(r.avgClockIn)}</td>
                        <td className="py-3 px-4 text-right text-zinc-300 whitespace-nowrap">{fmt12(r.avgClockOut)}</td>
                        <td className={`py-3 px-4 text-right whitespace-nowrap ${r.lateDays > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
                          {r.daysActive === 0 ? '—' : `${fmtMinutes(r.avgLateMinutes)} avg · ${r.lateDays}d`}
                        </td>
                        <td className={`py-3 px-4 text-right whitespace-nowrap ${r.earlyLeaveDays > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
                          {r.daysActive === 0 ? '—' : `${fmtMinutes(r.avgEarlyLeaveMinutes)} avg · ${r.earlyLeaveDays}d`}
                        </td>
                        <td className="py-3 px-4 text-right text-zinc-400">{r.lunchHours.toFixed(1)}h</td>
                        <td className="py-3 px-4 text-right text-zinc-400">{r.breakHours.toFixed(1)}h</td>
                        <td className="py-3 px-4 text-right font-black text-zinc-100">{r.totalHours.toFixed(1)}h</td>
                        <td className="py-3 px-4 text-right text-zinc-300">{r.totalHoursPercentOfTarget.toFixed(1)}%</td>
                        <td className="py-3 px-4 text-right font-bold text-zinc-100">{r.streamHours.toFixed(1)}h</td>
                        <td className="py-3 px-4 text-right text-zinc-300">{r.streamPercentOfTarget.toFixed(1)}%</td>
                        <td className="py-3 px-4 text-right">
                          {r.paidFull ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase whitespace-nowrap">
                              <CheckCircle2 className="w-3 h-3" />
                              Paid Full
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 uppercase whitespace-nowrap">
                              <XCircle className="w-3 h-3" />
                              Below Threshold
                            </span>
                          )}
                        </td>
                      </tr>,
                    ];
                    if (isOpen) rows.push(renderDayRows(r));
                    return rows;
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono uppercase">
            Total Hours = clock in → clock out per day (includes lunch/breaks). Streamed = screen-share time. Click a member for the daily clock in / out / lunch log.
          </div>
        </section>
      )}
    </div>
  );
};
