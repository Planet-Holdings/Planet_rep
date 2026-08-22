export default async function handler(req: any, res: any) {
  try {
    const { getSessionHistory } = await import('./_db.js');
    const { userId, channelId, activityType, startDate, endDate, limit, offset } = req.query;

    const result = await getSessionHistory({
      userId: userId ? String(userId) : undefined,
      channelId: channelId ? String(channelId) : undefined,
      activityType: (activityType as any) || 'all',
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      limit: limit ? parseInt(String(limit), 10) : 50,
      offset: offset ? parseInt(String(offset), 10) : 0,
    });

    res.status(200).json(result);
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || 'Failed to load sessions',
      stack: e?.stack,
    });
  }
}
