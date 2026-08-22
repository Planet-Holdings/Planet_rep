import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { OverviewTab } from './components/OverviewTab';
import { LiveChannelsTab } from './components/LiveChannelsTab';
import { MembersStatsTab } from './components/MembersStatsTab';
import { SessionHistoryTab } from './components/SessionHistoryTab';
import { ReportsTab } from './components/ReportsTab';
import { InactiveTab } from './components/InactiveTab';
import { SlashCommandsTab } from './components/SlashCommandsTab';
import {
  BotStatusConfig,
  VoiceChannelData,
  AlertLogItem,
  GuildMemberSummary
} from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [status, setStatus] = useState<BotStatusConfig | null>(null);
  const [overviewData, setOverviewData] = useState<any>(null);
  const [channels, setChannels] = useState<VoiceChannelData[]>([]);
  const [alerts, setAlerts] = useState<AlertLogItem[]>([]);
  const [allMembers, setAllMembers] = useState<GuildMemberSummary[]>([]);
  const [initialSlashCommand, setInitialSlashCommand] = useState<{ command: string; args?: any } | null>(null);
  const [membersLoadedAt, setMembersLoadedAt] = useState<number>(0);

  // Data fetching
  const refreshAllData = useCallback(async () => {
    try {
      const bootstrapRes = await fetch('/api/bootstrap');
      const bootstrapData = await bootstrapRes.json();

      setStatus(bootstrapData.status || null);
      setOverviewData(bootstrapData.overview || null);
      setChannels(bootstrapData.channels?.channels || []);
      setAlerts(bootstrapData.alerts?.logs || []);
    } catch (err) {
      console.error('Error fetching tracker data:', err);
    }
  }, []);

  const refreshMembersData = useCallback(async () => {
    try {
      const inactiveRes = await fetch('/api/inactive?days=7');
      const inactiveData = await inactiveRes.json();
      setAllMembers(inactiveData.allMembers || []);
      setMembersLoadedAt(Date.now());
    } catch (err) {
      console.error('Error fetching members data:', err);
    }
  }, []);

  useEffect(() => {
    refreshAllData();
    const interval = setInterval(refreshAllData, 5000);
    return () => clearInterval(interval);
  }, [refreshAllData]);

  useEffect(() => {
    const shouldLoadMembers = activeTab === 'members' || activeTab === 'inactive' || activeTab === 'commands' || activeTab === 'reports';
    if (!shouldLoadMembers) return;

    const isStale = !membersLoadedAt || Date.now() - membersLoadedAt > 60_000;
    if (isStale) {
      refreshMembersData();
    }
  }, [activeTab, membersLoadedAt, refreshMembersData]);

  // Simulator actions
  const handleTriggerQuickAction = async (
    action: string,
    userId?: string,
    channelId?: string,
    channelName?: string
  ) => {
    try {
      await fetch('/api/simulate/quick-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, userId, channelId, channelName }),
      });
      await refreshAllData();
    } catch (e) {
      console.error('Error triggering quick action:', e);
    }
  };

  const handleOpenSlashStats = (userId: string, username: string) => {
    setInitialSlashCommand({ command: 'stats', args: { userId, timeframe: 'all' } });
    setActiveTab('commands');
  };

  const handleOpenSlashInactive = (days: number) => {
    setInitialSlashCommand({ command: 'inactive', args: { days } });
    setActiveTab('commands');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col antialiased selection:bg-zinc-100 selection:text-zinc-950">
      {/* Top Navigation & Status Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        status={status}
        onRefresh={refreshAllData}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
          <OverviewTab
            overviewData={overviewData}
            alerts={alerts}
            channels={channels}
            onTriggerQuickAction={handleTriggerQuickAction}
            onNavigateToTab={setActiveTab}
          />
        )}

        {activeTab === 'live' && (
          <LiveChannelsTab
            channels={channels}
            allMembers={allMembers}
            onTriggerQuickAction={handleTriggerQuickAction}
            onRefresh={refreshAllData}
          />
        )}

        {activeTab === 'members' && (
          <MembersStatsTab
            members={allMembers}
            onOpenSlashStats={handleOpenSlashStats}
          />
        )}

        {activeTab === 'sessions' && (
          <SessionHistoryTab onRefresh={refreshAllData} />
        )}

        {activeTab === 'reports' && (
          <ReportsTab members={allMembers} />
        )}

        {activeTab === 'inactive' && (
          <InactiveTab
            onRefresh={refreshAllData}
            onOpenSlashInactive={handleOpenSlashInactive}
          />
        )}

        {activeTab === 'commands' && (
          <SlashCommandsTab
            allMembers={allMembers}
            initialCommand={initialSlashCommand}
          />
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-5 text-xs text-zinc-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-3">
          <span className="uppercase font-bold tracking-wider">Discord Voice, Video & Stream Activity Tracker Engine</span>
          <span className="text-[11px] uppercase">discord.js v14 & discord.py 2.x • SQLite Session Store</span>
        </div>
      </footer>
    </div>
  );
}
