import React, { useState, useEffect } from 'react';
import {
  Mic,
  Video,
  Radio,
  Volume2,
  ArrowRightLeft,
  LogOut,
  Sparkles,
  RefreshCw,
  MonitorPlay
} from 'lucide-react';
import { VoiceChannelData, ActiveMemberState } from '../types';

interface LiveChannelsTabProps {
  channels: VoiceChannelData[];
  allMembers: any[];
  onTriggerQuickAction: (action: string, userId?: string, channelId?: string, channelName?: string) => void;
  onRefresh: () => void;
}

export const LiveChannelsTab: React.FC<LiveChannelsTabProps> = ({
  channels,
  allMembers,
  onTriggerQuickAction,
  onRefresh,
}) => {
  const [selectedUser, setSelectedUser] = useState<string>(allMembers[0]?.userId || '101');
  const [selectedChannel, setSelectedChannel] = useState<string>(channels[0]?.id || 'vc-1');
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  // Timer ticker for live elapsed duration
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatElapsed = (startMs: number) => {
    const sec = Math.max(0, Math.floor((currentTime - startMs) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m ${s < 10 ? '0' + s : s}s`;
    return `${m}m ${s < 10 ? '0' + s : s}s`;
  };

  // Find if selected member is currently active
  const currentActiveUser = channels
    .flatMap((c) => c.members)
    .find((m) => m.userId === selectedUser);

  const selectedChanObj = channels.find((c) => c.id === selectedChannel) || channels[0];

  return (
    <div className="space-y-8">
      {/* 01. Interactive Voice State Simulator Panel */}
      <section className="bg-zinc-900 border border-zinc-800 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4 border-b border-zinc-800 pb-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              01. Voice State Event Simulator
            </h2>
            <p className="text-sm font-bold text-zinc-200 mt-1 uppercase tracking-tight">
              Instant voiceStateUpdate Dispatcher
            </p>
          </div>

          {currentActiveUser && (
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/40 text-xs text-emerald-400 font-mono font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>ACTIVE IN #{currentActiveUser.channelName} (⏱️ {formatElapsed(currentActiveUser.voiceStartTime)})</span>
            </div>
          )}
        </div>

        {/* Simulator Controls Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          {/* Target Member Picker */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1.5">
              Target Member
            </label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 font-mono font-bold"
            >
              {allMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  @{m.username} ({m.userTag})
                </option>
              ))}
            </select>
          </div>

          {/* Target Voice Channel Picker */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1.5">
              Target Channel
            </label>
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 font-mono font-bold"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name} ({c.members.length} active)
                </option>
              ))}
            </select>
          </div>

          {/* State Actions Buttons */}
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            {!currentActiveUser ? (
              <button
                onClick={() => selectedChanObj && onTriggerQuickAction('join_voice', selectedUser, selectedChanObj.id, selectedChanObj.name)}
                disabled={!selectedChanObj}
                title={!selectedChanObj ? 'No voice channels available yet' : undefined}
                className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
              >
                <Mic className="w-3.5 h-3.5" />
                Join Channel
              </button>
            ) : (
              <>
                <button
                  onClick={() => onTriggerQuickAction('toggle_camera', selectedUser)}
                  className={`flex-1 px-3 py-2 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                    currentActiveUser.isVideo
                      ? 'bg-sky-500 text-black'
                      : 'bg-zinc-950 text-sky-400 border border-zinc-800 hover:bg-zinc-800'
                  }`}
                >
                  <Video className="w-3.5 h-3.5" />
                  {currentActiveUser.isVideo ? 'Cam OFF' : 'Cam ON'}
                </button>

                <button
                  onClick={() => onTriggerQuickAction('toggle_stream', selectedUser)}
                  className={`flex-1 px-3 py-2 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                    currentActiveUser.isStreaming
                      ? 'bg-red-500 text-white'
                      : 'bg-zinc-950 text-emerald-400 border border-zinc-800 hover:bg-zinc-800'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  {currentActiveUser.isStreaming ? 'Stop Stream' : 'Go Live'}
                </button>

                <button
                  onClick={() => selectedChanObj && onTriggerQuickAction('switch_channel', selectedUser, selectedChanObj.id, selectedChanObj.name)}
                  disabled={!selectedChanObj}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-all border border-zinc-700"
                  title={!selectedChanObj ? 'No voice channels available yet' : 'Switch to selected channel'}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  Switch
                </button>

                <button
                  onClick={() => onTriggerQuickAction('leave_voice', selectedUser)}
                  className="px-3 py-2 bg-zinc-950 hover:bg-red-950/60 text-red-400 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-all border border-zinc-800 hover:border-red-900/60"
                  title="Disconnect from voice"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Leave
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* 02. Voice Channels Grid */}
      <section>
        <div className="flex items-baseline justify-between mb-4 border-b border-zinc-800 pb-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              02. Discord Voice Channels ({channels.length})
            </h2>
            <p className="text-sm font-bold text-zinc-200 mt-1 uppercase tracking-tight">
              Live Voice Presence, Camera & Screen Sharing Rooms
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-mono uppercase font-bold border border-zinc-800 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="bg-zinc-900/90 border border-zinc-800 overflow-hidden flex flex-col justify-between"
            >
              {/* Channel Header */}
              <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-black uppercase tracking-tight text-zinc-100 font-mono">
                    #{channel.name}
                  </span>
                </div>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono">
                  {channel.members.length} {channel.members.length === 1 ? 'MEMBER' : 'MEMBERS'}
                </span>
              </div>

              {/* Members in Channel */}
              <div className="p-4 flex-1 space-y-3">
                {channel.members.length === 0 ? (
                  <div className="py-8 text-center text-xs font-mono uppercase text-zinc-600">
                    Channel is currently empty
                  </div>
                ) : (
                  channel.members.map((member) => {
                    let borderClass = 'border-l-4 border-zinc-700 bg-zinc-950/60';
                    if (member.isStreaming) borderClass = 'border-l-4 border-emerald-500 bg-zinc-950';
                    else if (member.isVideo) borderClass = 'border-l-4 border-sky-500 bg-zinc-950';

                    return (
                      <div
                        key={member.userId}
                        className={`p-3 ${borderClass} border-r border-t border-b border-zinc-800/80 space-y-2`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <img
                              src={member.avatarUrl}
                              alt={member.username}
                              className="w-8 h-8 rounded-full border border-zinc-700 object-cover"
                            />
                            <div>
                              <span className="text-xs font-bold text-zinc-100 block font-mono">
                                @{member.username}
                              </span>
                              <span className="text-[10px] text-zinc-500 block font-mono">
                                ⏱️ {member.isStreaming && member.streamStartTime ? formatElapsed(member.streamStartTime) : member.isVideo && member.videoStartTime ? formatElapsed(member.videoStartTime) : formatElapsed(member.voiceStartTime)}
                              </span>
                            </div>
                          </div>

                          {/* Badges */}
                          <div className="flex items-center gap-1.5">
                            {member.isStreaming && (
                              <span className="px-1.5 py-0.2 text-[9px] font-black bg-emerald-500 text-black uppercase">
                                LIVE
                              </span>
                            )}
                            {member.isVideo && (
                              <span className="px-1.5 py-0.2 text-[9px] font-black bg-sky-500 text-black uppercase">
                                VIDEO
                              </span>
                            )}
                            {!member.isVideo && !member.isStreaming && (
                              <span className="px-1.5 py-0.2 text-[9px] font-bold bg-zinc-800 text-zinc-400 uppercase font-mono">
                                VOICE
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Stream Title or Activity detail */}
                        {member.isStreaming && member.streamTitle && (
                          <div className="text-[10px] text-emerald-400 font-mono bg-zinc-900 px-2 py-1 border border-zinc-800 truncate flex items-center gap-1">
                            <MonitorPlay className="w-3 h-3 shrink-0 text-emerald-400" />
                            <span className="truncate">{member.streamTitle}</span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
