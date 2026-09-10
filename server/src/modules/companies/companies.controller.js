import { updateProfileSchema, siteSchema } from './companies.validation.js';
import * as companiesService from './companies.service.js';
import { AppError } from '../../middleware/errorHandler.js';

// Le frontend consomme systématiquement du camelCase (voir auth.controller.js
// /me) — la ligne DB brute est en snake_case, jamais renvoyée telle quelle.
function serializeCompany(row) {
  return {
    id: row.id,
    name: row.name,
    sector: row.sector,
    headcount: row.headcount,
    baseYear: row.base_year,
    annualRevenueMad: row.annual_revenue_mad === null ? null : Number(row.annual_revenue_mad),
    reportingFrequency: row.reporting_frequency,
    createdAt: row.created_at,
  };
}

export async function getProfile(req, res, next) {
  try {
    const company = await companiesService.getCompany(req.auth.companyId);
    res.json({ company: serializeCompany(company) });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Données invalides.', parsed.error.flatten());
    }
    const company = await companiesService.updateCompanyProfile(
      req.auth.companyId,
      req.auth.userId,
      parsed.data,
    );
    res.json({ company: serializeCompany(company) });
  } catch (err) {
    next(err);
  }
}

export async function listSites(req, res, next) {
  try {
    const sites = await companiesService.listSites(req.auth.companyId);
    res.json({ sites });
  } catch (err) {
    next(err);
  }
}

export async function createSite(req, res, next) {
  try {
    const parsed = siteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Données invalides.', parsed.error.flatten());
    }
    const site = await companiesService.createSite(req.auth.companyId, parsed.data);
    res.status(201).json({ site });
  } catch (err) {
    next(err);
  }
}

export async function updateSite(req, res, next) {
  try {
    const parsed = siteSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Données invalides.', parsed.error.flatten());
    }
    const site = await companiesService.updateSite(
      req.auth.companyId,
      Number(req.params.siteId),
      parsed.data,
    );
    res.json({ site });
  } catch (err) {
    next(err);
  }
}

export async function deleteSite(req, res, next) {
  try {
    await companiesService.deleteSite(req.auth.companyId, Number(req.params.siteId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
