import React from 'react';
import {
  Mic,
  Video,
  Radio,
  BarChart3,
  Users,
  History,
  Moon,
  Terminal,
  Activity,
  Sparkles,
  ClipboardList
} from 'lucide-react';
import { BotStatusConfig } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  status: BotStatusConfig | null;
  onRefresh: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  status,
  onRefresh,
}) => {
  const tabs = [
    { id: 'overview', label: '01. Overview', icon: BarChart3 },
    { id: 'live', label: '02. Live Channels', icon: Radio, badge: status?.activeVoiceCount },
    { id: 'members', label: '03. Member Stats', icon: Users },
    { id: 'sessions', label: '04. Session History', icon: History },
    { id: 'reports', label: '05. Reports', icon: ClipboardList },
    { id: 'inactive', label: '06. Inactive Audit', icon: Moon },
    { id: 'commands', label: '07. Slash Commands', icon: Terminal },
  ];

  return (
    <header className="bg-zinc-950 border-b border-zinc-800 sticky top-0 z-40">
      {/* Top Banner / Status Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-4 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-900">
        <div>
          <div className="flex flex-wrap items-baseline gap-3 mb-1">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tighter uppercase text-zinc-100 leading-none">
              Discord<span className="text-zinc-500 font-light ml-2">Monitor</span>
            </h1>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                status?.discordConnected ? 'bg-emerald-500 text-black' : 'bg-zinc-100 text-zinc-950'
              }`}>
                {status?.discordConnected ? 'SYSTEM ONLINE' : 'SIMULATION ENGINE'}
              </span>
              <span className="text-zinc-500 text-xs font-mono">v4.2.0-STABLE</span>
            </div>
          </div>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 font-bold">
            Real-Time Voice • Video Calls • Screen Sharing / Go Live Activity
          </p>
        </div>

        {/* Real-time Status Counters */}
        <div className="flex items-center flex-wrap gap-2 sm:gap-3 text-xs">
          <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 px-3 py-1.5 font-mono">
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <Mic className="w-3.5 h-3.5" />
              <span>{status?.activeVoiceCount || 0} VOICE</span>
            </span>
            <span className="text-zinc-700">/</span>
            <span className="flex items-center gap-1.5 text-sky-400 font-bold">
              <Video className="w-3.5 h-3.5" />
              <span>{status?.activeVideoCount || 0} VIDEO</span>
            </span>
            <span className="text-zinc-700">/</span>
            <span className="flex items-center gap-1.5 text-red-400 font-bold">
              <Radio className="w-3.5 h-3.5" />
              <span>{status?.activeStreamCount || 0} STREAM</span>
            </span>
          </div>

          <button
            onClick={onRefresh}
            title="Refresh Live Data"
            className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition-colors border border-zinc-800 hover:border-zinc-700 active:scale-95"
          >
            <Activity className="w-4 h-4 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1 sm:space-x-2 overflow-x-auto py-2 scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap border-b-2 ${
                  isActive
                    ? 'border-zinc-100 text-zinc-100 bg-zinc-900 font-black'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-zinc-100' : 'text-zinc-500'}`} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="px-1.5 py-0.2 text-[9px] font-black bg-emerald-500 text-black">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
