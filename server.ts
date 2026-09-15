import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import { botEngine } from './server/botEngine';
import { initDiscordBot, getDiscordStatus, sendReminderDM } from './server/discordBot';
import {
  captureStats,
  checkToken,
  findCapture,
  isConfigured as captureConfigured,
  listCaptures,
  pruneOldCaptures,
  saveCapture,
  shouldCapture,
} from './server/capture';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

  app.use(express.json());

  // Initialize Discord Bot if token is present in environment
  initDiscordBot();

  // --- API Endpoints ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
  });

  // Bot Status & Config
  app.get('/api/bot/status', async (req, res) => {
    const discordInfo = getDiscordStatus();
    const overview = await db.getOverviewAnalytics();
    res.json({
      mode: discordInfo.isConnected ? 'live' : 'simulation',
      discordConnected: discordInfo.isConnected,
      botTag: discordInfo.botTag,
      guildCount: discordInfo.guildCount,
      activeVoiceCount: overview.activeVoiceCount,
      activeVideoCount: overview.activeVideoCount,
      activeStreamCount: overview.activeStreamCount,
      totalLoggedSessions: overview.totalSessionsCount,
      totalTrackedMembers: overview.totalGuildMembersCount,
      uptimeSeconds: process.uptime(),
      alertChannelName: '#stream-announcements',
      inactiveThresholdDays: 7,
      autoAlertStream: true,
      autoAlertVideo: true,
    });
  });

  app.get('/api/bootstrap', async (req, res) => {
    const discordInfo = getDiscordStatus();
    const [overview, channels, logs] = await Promise.all([
      db.getOverviewAnalytics(),
      db.getChannels(),
      db.getAlertLogs(25),
    ]);

    res.json({
      status: {
        mode: discordInfo.isConnected ? 'live' : 'simulation',
        discordConnected: discordInfo.isConnected,
        botTag: discordInfo.botTag,
        guildCount: discordInfo.guildCount,
        activeVoiceCount: overview.activeVoiceCount,
        activeVideoCount: overview.activeVideoCount,
        activeStreamCount: overview.activeStreamCount,
        totalLoggedSessions: overview.totalSessionsCount,
        totalTrackedMembers: overview.totalGuildMembersCount,
        uptimeSeconds: process.uptime(),
        alertChannelName: '#stream-announcements',
        inactiveThresholdDays: 7,
        autoAlertStream: true,
        autoAlertVideo: true,
      },
      overview,
      channels: { channels },
      alerts: { logs },
    });
  });

  // Connect live bot via custom token
  app.post('/api/bot/connect', async (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Bot token is required' });
    }
    try {
      await initDiscordBot(token);
      res.json({ success: true, status: getDiscordStatus() });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to connect bot' });
    }
  });

  // Send an inactivity reminder DM to a member
  app.post('/api/bot/send-reminder', async (req, res) => {
    const { userId, username, daysSinceLastActive } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const message = `Hey${username ? ` ${username}` : ''}! We noticed you haven't been active in voice chat for ${daysSinceLastActive ?? 'a while'} days. Come join us when you get a chance!`;
    const result = await sendReminderDM(userId, message);
    if (!result.sent) {
      return res.status(result.simulated ? 409 : 500).json(result);
    }
    res.json(result);
  });

  // Overview Analytics
  app.get('/api/overview', async (req, res) => {
    const data = await db.getOverviewAnalytics();
    res.json(data);
  });

  // Channels & Active Room Members
  app.get('/api/channels', async (req, res) => {
    const channels = await db.getChannels();
    res.json({ channels });
  });

  // Active Users List
  app.get('/api/active', async (req, res) => {
    const active = await db.getAllActiveStates();
    res.json({ active });
  });

  // Session History (Paginated + Filterable)
  app.get('/api/sessions', async (req, res) => {
    const { userId, channelId, activityType, startDate, endDate, limit, offset } = req.query;
    const result = await db.getSessionHistory({
      userId: userId ? String(userId) : undefined,
      channelId: channelId ? String(channelId) : undefined,
      activityType: (activityType as any) || 'all',
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      limit: limit ? parseInt(String(limit), 10) : 50,
      offset: offset ? parseInt(String(offset), 10) : 0,
    });
    res.json(result);
  });

  // Payroll/Attendance Report (arbitrary date range, one or more members)
  app.post('/api/report', async (req, res) => {
    const { userIds, startDate, endDate } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    try {
      const report = await db.getReport({
        userIds: Array.isArray(userIds) && userIds.length > 0 ? userIds : undefined,
        startDate: String(startDate),
        endDate: String(endDate),
      });
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to generate report' });
    }
  });

  // --- Workstation screenshot capture ---
  // The agent on a rep's machine polls this; the server only says "capture"
  // while that member is actually screen-sharing right now, so the image
  // always shows what they were streaming.
  app.get('/api/capture/should', async (req, res) => {
    if (!captureConfigured()) {
      return res.status(503).json({ error: 'Capture is not configured (CAPTURE_TOKEN unset)' });
    }
    if (!checkToken(String(req.query.token || req.get('x-capture-token') || ''))) {
      return res.status(401).json({ error: 'Invalid capture token' });
    }
    const userId = String(req.query.userId || '');
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const active = await db.getActiveState(userId);
    const decision = shouldCapture({ userId, isStreaming: !!active?.isStreaming });
    res.json({
      ...decision,
      username: active?.username || null,
      channelName: active?.channelName || null,
      pollSeconds: Number(process.env.CAPTURE_POLL_SECONDS) || 300,
    });
  });

  app.post(
    '/api/capture',
    express.raw({ type: ['image/png', 'application/octet-stream'], limit: '10mb' }),
    async (req, res) => {
      if (!captureConfigured()) {
        return res.status(503).json({ error: 'Capture is not configured (CAPTURE_TOKEN unset)' });
      }
      if (!checkToken(String(req.query.token || req.get('x-capture-token') || ''))) {
        return res.status(401).json({ error: 'Invalid capture token' });
      }
      const userId = String(req.query.userId || '');
      if (!userId) return res.status(400).json({ error: 'userId is required' });

      try {
        const active = await db.getActiveState(userId);
        const record = saveCapture({
          userId,
          username: active?.username || String(req.query.username || '') || 'Unknown',
          channelName: active?.channelName || null,
          agentHost: (req.query.host as string) || null,
          agentPlatform: (req.query.platform as string) || null,
          image: req.body as Buffer,
        });
        console.log(`[Capture] Stored ${record.id} (${record.bytes} bytes) for ${record.username}`);
        res.json({ ok: true, id: record.id, takenAtLocal: record.takenAtLocal });
      } catch (e: any) {
        console.error('[Capture] Save failed:', e);
        res.status(400).json({ error: e.message || 'Failed to store capture' });
      }
    }
  );

  // Dashboard: list capture metadata and stream a stored image.
  app.get('/api/capture/list', (req, res) => {
    const { date, userId, limit } = req.query;
    const result = listCaptures({
      date: date ? String(date) : undefined,
      userId: userId ? String(userId) : undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
    });
    res.json({ ...result, stats: captureStats() });
  });

  app.get('/api/capture/image/:id', (req, res) => {
    const found = findCapture(String(req.params.id));
    if (!found) return res.status(404).json({ error: 'Capture not found' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(found.file);
  });

  // User Stats (/stats)
  app.get('/api/stats/:userId', async (req, res) => {
    const { userId } = req.params;
    const timeframe = (req.query.timeframe as any) || 'all';
    const stats = await db.getUserStats(userId, timeframe);
    res.json(stats);
  });

  // Inactive Members (/inactive)
  app.get('/api/inactive', async (req, res) => {
    const days = req.query.days ? parseInt(String(req.query.days), 10) : 7;
    const report = await db.getInactiveMembers(days);
    res.json(report);
  });

  // Leaderboard (/leaderboard)
  app.get('/api/leaderboard', async (req, res) => {
    const type = (req.query.type as any) || 'stream';
    const timeframe = (req.query.timeframe as any) || 'weekly';
    const leaderboard = await db.getLeaderboard(type, timeframe);
    res.json({ leaderboard, type, timeframe });
  });

  // Alert Logs
  app.get('/api/alerts', async (req, res) => {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const logs = await db.getAlertLogs(limit);
    res.json({ logs });
  });

  // Execute Slash Command & Return Discord Embed
  app.post('/api/command/execute', async (req, res) => {
    const { command, args } = req.body;

    if (command === 'stats') {
      const userId = args?.userId || '101';
      const timeframe = args?.timeframe || 'all';
      const response = await botEngine.executeStatsCommand(userId, timeframe);
      return res.json(response);
    }

    if (command === 'live') {
      const response = await botEngine.executeLiveCommand();
      return res.json(response);
    }

    if (command === 'inactive') {
      const days = args?.days ? parseInt(args.days, 10) : 7;
      const response = await botEngine.executeInactiveCommand(days);
      return res.json(response);
    }

    if (command === 'leaderboard') {
      const type = args?.type || 'stream';
      const timeframe = args?.timeframe || 'weekly';
      const response = await botEngine.executeLeaderboardCommand(type, timeframe);
      return res.json(response);
    }

    res.status(400).json({ error: 'Unknown command' });
  });

  // Simulation: Trigger Voice State Update
  app.post('/api/simulate/voice-update', async (req, res) => {
    const { oldState, newState } = req.body;
    if (!newState) {
      return res.status(400).json({ error: 'newState is required' });
    }
    await botEngine.handleVoiceStateUpdate(oldState || { channelId: null, userId: newState.userId }, newState);
    res.json({ success: true, active: await db.getAllActiveStates() });
  });

  // Simulation: Quick action helper
  app.post('/api/simulate/quick-action', async (req, res) => {
    const { action, userId, channelId, channelName } = req.body;
    const allMembers = await db.getGuildMembers();
    const targetMember = allMembers.find(m => m.userId === userId) || allMembers[0];
    if (!targetMember) {
      return res.status(400).json({ error: 'No guild members available to simulate yet. Have someone join a voice channel first.' });
    }
    const current = await db.getActiveState(targetMember.userId);

    const now = Date.now();

    if (action === 'join_voice') {
      await botEngine.handleVoiceStateUpdate(
        { userId: targetMember.userId, username: targetMember.username, userTag: targetMember.userTag, avatarUrl: targetMember.avatarUrl, guildId: 'guild-main', channelId: null },
        { userId: targetMember.userId, username: targetMember.username, userTag: targetMember.userTag, avatarUrl: targetMember.avatarUrl, guildId: 'guild-main', channelId: channelId || 'vc-1', channelName: channelName || '🔊 General Voice' }
      );
    } else if (action === 'toggle_camera') {
      if (current) {
        await botEngine.handleVoiceStateUpdate(
          { ...current, channelId: current.channelId },
          { ...current, channelId: current.channelId, selfVideo: !current.isVideo }
        );
      }
    } else if (action === 'toggle_stream') {
      if (current) {
        await botEngine.handleVoiceStateUpdate(
          { ...current, channelId: current.channelId },
          {
            ...current,
            channelId: current.channelId,
            streaming: !current.isStreaming,
            streamTitle: !current.isStreaming ? `${targetMember.username}'s Live Broadcast` : undefined,
          }
        );
      }
    } else if (action === 'switch_channel') {
      if (current) {
        await botEngine.handleVoiceStateUpdate(
          { ...current, channelId: current.channelId },
          { ...current, channelId: channelId || 'vc-2', channelName: channelName || '🎮 Gaming & Co-op' }
        );
      }
    } else if (action === 'leave_voice') {
      if (current) {
        await botEngine.handleVoiceStateUpdate(
          { ...current, channelId: current.channelId },
          { userId: targetMember.userId, username: targetMember.username, userTag: targetMember.userTag, avatarUrl: targetMember.avatarUrl, guildId: 'guild-main', channelId: null }
        );
      }
    }

    res.json({
      success: true,
      channels: await db.getChannels(),
      active: await db.getAllActiveStates(),
      alerts: await db.getAlertLogs(10),
    });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Discord Voice Tracker Running on http://localhost:${PORT}`);
    const cap = captureStats();
    console.log(
      `[Capture] ${cap.enabled ? 'enabled' : 'DISABLED (set CAPTURE_TOKEN)'} — ` +
        `${cap.capturesPerDay}/day, ${cap.retentionDays}d retention, dir ${cap.directory}`
    );
    if (cap.enabled) pruneOldCaptures(true);
  });
}

startServer();
