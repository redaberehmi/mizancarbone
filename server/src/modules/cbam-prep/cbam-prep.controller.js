import * as service from './cbam-prep.service.js';

export async function getRelevance(req, res, next) {
  try {
    const relevance = await service.getSectorRelevance(req.auth.companyId);
    res.json(relevance);
  } catch (err) {
    next(err);
  }
}

export async function getProducts(req, res, next) {
  try {
    const products = await service.listDistinctProducts(req.auth.companyId);
    res.json({ products });
  } catch (err) {
    next(err);
  }
}

export async function getSummary(req, res, next) {
  try {
    const summary = await service.getPreparationSummary(req.auth.companyId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
}

export async function exportCsv(req, res, next) {
  try {
    const { filename, content } = await service.buildCsvExport(req.auth.companyId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) {
    next(err);
  }
}

export async function exportPdf(req, res, next) {
  try {
    const { filename, buffer } = await service.buildPdfExport(req.auth.companyId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}
