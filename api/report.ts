import { buildAttendanceReport, configFromEnv, resolveRange } from '../server/attendance';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { fetchReportInputs } = await import('./_db.js');
    const { userIds, startDate, endDate } = req.body || {};

    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate and endDate are required' });
      return;
    }

    const config = configFromEnv();
    const range = resolveRange(String(startDate), String(endDate), config.timezone);
    const ids = Array.isArray(userIds) && userIds.length > 0 ? userIds.map(String) : undefined;

    const inputs = await fetchReportInputs({
      userIds: ids,
      rangeStartIso: new Date(range.startMs).toISOString(),
      rangeEndIso: new Date(range.endMs).toISOString(),
    });

    const report = buildAttendanceReport({
      ...inputs,
      userIds: ids,
      startDate: String(startDate),
      endDate: String(endDate),
      config,
    });

    res.status(200).json(report);
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || 'Failed to generate report',
      stack: e?.stack,
    });
  }
}
