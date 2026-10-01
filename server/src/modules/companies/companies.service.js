import { pool, withTransaction } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function getCompany(companyId) {
  const result = await pool.query(
    `SELECT id, name, sector, headcount, base_year, annual_revenue_mad, reporting_frequency, declared_size_category, created_at
     FROM companies WHERE id = $1`,
    [companyId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'Entreprise introuvable.');
  }
  return result.rows[0];
}

// Toute modification de base_year après une première valeur déjà enregistrée
// exige une raison et une trace dans base_year_recalculations — jamais de
// recalcul silencieux (exigence méthodologique GHG Protocol, section 5).
export async function updateCompanyProfile(companyId, userId, changes) {
  return withTransaction(async (client) => {
    const current = await client.query(
      `SELECT id, name, sector, headcount, base_year, annual_revenue_mad, reporting_frequency, declared_size_category
       FROM companies WHERE id = $1 FOR UPDATE`,
      [companyId],
    );
    if (current.rows.length === 0) {
      throw new AppError(404, 'Entreprise introuvable.');
    }
    const company = current.rows[0];

    const baseYearChanging =
      Object.prototype.hasOwnProperty.call(changes, 'baseYear') &&
      changes.baseYear !== company.base_year;

    if (baseYearChanging && company.base_year !== null && company.base_year !== undefined) {
      if (!changes.baseYearChangeReason) {
        throw new AppError(
          400,
          "Une raison est obligatoire pour modifier l'année de référence déjà établie.",
        );
      }
      await client.query(
        `INSERT INTO base_year_recalculations
           (company_id, previous_base_year, new_base_year, reason, recalculated_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, company.base_year, changes.baseYear, changes.baseYearChangeReason, userId],
      );
    }

    const next = {
      name: changes.name ?? company.name,
      sector: changes.sector ?? company.sector,
      headcount: changes.headcount === undefined ? company.headcount : changes.headcount,
      base_year: changes.baseYear === undefined ? company.base_year : changes.baseYear,
      annual_revenue_mad: changes.annualRevenueMad === undefined ? company.annual_revenue_mad : changes.annualRevenueMad,
      reporting_frequency: changes.reportingFrequency === undefined ? company.reporting_frequency : changes.reportingFrequency,
      declared_size_category: changes.declaredSizeCategory === undefined ? company.declared_size_category : changes.declaredSizeCategory,
    };

    const result = await client.query(
      `UPDATE companies SET name = $1, sector = $2, headcount = $3, base_year = $4,
              annual_revenue_mad = $5, reporting_frequency = $6, declared_size_category = $7
       WHERE id = $8
       RETURNING id, name, sector, headcount, base_year, annual_revenue_mad, reporting_frequency, declared_size_category, created_at`,
      [next.name, next.sector, next.headcount, next.base_year, next.annual_revenue_mad, next.reporting_frequency, next.declared_size_category, companyId],
    );

    return result.rows[0];
  });
}

export async function listSites(companyId) {
  const result = await pool.query(
    `SELECT id, name, city FROM sites WHERE company_id = $1 ORDER BY name`,
    [companyId],
  );
  return result.rows;
}

export async function createSite(companyId, { name, city }) {
  const result = await pool.query(
    `INSERT INTO sites (company_id, name, city) VALUES ($1, $2, $3)
     RETURNING id, name, city`,
    [companyId, name, city ?? null],
  );
  return result.rows[0];
}

export async function updateSite(companyId, siteId, { name, city }) {
  // company_id dans le WHERE : un site d'une autre entreprise ne peut jamais
  // être modifié, même si son id est deviné (exigence section 7.1).
  const result = await pool.query(
    `UPDATE sites SET name = COALESCE($1, name), city = $2
     WHERE id = $3 AND company_id = $4
     RETURNING id, name, city`,
    [name ?? null, city ?? null, siteId, companyId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'Site introuvable.');
  }
  return result.rows[0];
}

export async function deleteSite(companyId, siteId) {
  const result = await pool.query(
    `DELETE FROM sites WHERE id = $1 AND company_id = $2 RETURNING id`,
    [siteId, companyId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'Site introuvable.');
  }
}
