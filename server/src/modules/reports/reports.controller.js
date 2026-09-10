import { buildRawDataCsvExport, buildDashboardPdfExport } from './reports.service.js';
import { getDashboardAnalytics } from './dashboard-analytics.service.js';

export async function getDashboardAnalyticsRoute(req, res, next) {
  try {
    const analytics = await getDashboardAnalytics(req.auth.companyId);
    res.json(analytics);
  } catch (err) {
    next(err);
  }
}

export async function exportCsv(req, res, next) {
  try {
    const { filename, content } = await buildRawDataCsvExport(req.auth.companyId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) {
    next(err);
  }
}

export async function exportPdf(req, res, next) {
  try {
    const { filename, buffer } = await buildDashboardPdfExport(req.auth.companyId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}
