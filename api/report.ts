export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { getReport } = await import('./_db.js');
    const { userIds, startDate, endDate } = req.body || {};

    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate and endDate are required' });
      return;
    }

    const report = await getReport({
      userIds: Array.isArray(userIds) && userIds.length > 0 ? userIds : undefined,
      startDate: String(startDate),
      endDate: String(endDate),
    });

    res.status(200).json(report);
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || 'Failed to generate report',
      stack: e?.stack,
    });
  }
}
