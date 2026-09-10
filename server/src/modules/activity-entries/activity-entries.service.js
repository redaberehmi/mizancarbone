import { pool } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { RAW_MATERIAL_FACTOR_CODE, DIRECT_ENTRY_CATEGORIES } from './constants.js';
import { computeResultForEnergyEntry, getFactorForPeriodOrExplain } from '../calculation/calculation.service.js';

async function assertSiteOwnedByCompany(companyId, siteId) {
  const result = await pool.query('SELECT id FROM sites WHERE id = $1 AND company_id = $2', [
    siteId,
    companyId,
  ]);
  if (result.rows.length === 0) {
    throw new AppError(400, "Ce site n'existe pas ou n'appartient pas à votre entreprise.");
  }
}

export async function listAvailableFactors() {
  const result = await pool.query(
    `SELECT id, code, label, scope, category, unit, value_kgco2e, source, is_national
     FROM emission_factors
     WHERE category = ANY($1) AND valid_to IS NULL
     ORDER BY category, label`,
    [DIRECT_ENTRY_CATEGORIES],
  );
  return result.rows;
}

export async function createEnergyEntry(companyId, userId, data) {
  await assertSiteOwnedByCompany(companyId, data.siteId);

  // La sélection compare valid_from/valid_to du facteur à period_start/
  // period_end de l'entrée (jamais "valid_to IS NULL" isolément) — voir
  // calculation.service.js pour le détail. Si la période traverse un
  // changement de version, le message explique précisément pourquoi plutôt
  // qu'un message générique.
  const { factor, error } = await getFactorForPeriodOrExplain(
    data.factorCode,
    DIRECT_ENTRY_CATEGORIES,
    data.periodStart,
    data.periodEnd,
  );
  if (!factor) {
    throw new AppError(400, error);
  }

  const result = await pool.query(
    `INSERT INTO activity_entries
       (company_id, site_id, period_start, period_end, factor_code, quantity, source_document, entered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, site_id, period_start, period_end, factor_code, quantity, source_document, created_at`,
    [
      companyId,
      data.siteId,
      data.periodStart,
      data.periodEnd,
      data.factorCode,
      data.quantity,
      data.sourceDocument ?? null,
      userId,
    ],
  );
  const entry = result.rows[0];

  // Calcul immédiat (Module 3) : le résultat est visible sans attendre un
  // recalcul manuel. Le facteur vient d'être validé ci-dessus, l'insertion
  // ne peut donc pas échouer pour une raison métier.
  await computeResultForEnergyEntry(entry.id, factor);

  return entry;
}

export async function createRawMaterialEntry(companyId, userId, data) {
  await assertSiteOwnedByCompany(companyId, data.siteId);

  const result = await pool.query(
    `INSERT INTO activity_entries
       (company_id, site_id, period_start, period_end, factor_code, quantity,
        material_label, supplier, source_document, entered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, site_id, period_start, period_end, factor_code, quantity,
               material_label, supplier, source_document, created_at`,
    [
      companyId,
      data.siteId,
      data.periodStart,
      data.periodEnd,
      RAW_MATERIAL_FACTOR_CODE,
      data.quantity,
      data.materialLabel,
      data.supplier ?? null,
      data.sourceDocument ?? null,
      userId,
    ],
  );
  return result.rows[0];
}

export async function listEntries(companyId, filters = {}) {
  const conditions = ['ae.company_id = $1', 'ae.deleted_at IS NULL'];
  const params = [companyId];

  if (filters.siteId) {
    params.push(filters.siteId);
    conditions.push(`ae.site_id = $${params.length}`);
  }
  if (filters.periodStart) {
    params.push(filters.periodStart);
    conditions.push(`ae.period_end >= $${params.length}`);
  }
  if (filters.periodEnd) {
    params.push(filters.periodEnd);
    conditions.push(`ae.period_start <= $${params.length}`);
  }

  const result = await pool.query(
    `SELECT ae.id, ae.site_id, s.name AS site_name, ae.period_start, ae.period_end,
            ae.factor_code, ae.quantity, ae.material_label, ae.supplier,
            ae.product_allocation, ae.source_document, ae.created_at
     FROM activity_entries ae
     LEFT JOIN sites s ON s.id = ae.site_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ae.period_start DESC, ae.id DESC`,
    params,
  );
  return result.rows;
}

export async function softDeleteEntry(companyId, entryId) {
  const result = await pool.query(
    `UPDATE activity_entries SET deleted_at = now()
     WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [entryId, companyId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'Entrée introuvable.');
  }
}

// Exception ciblée à la règle "pas d'édition" : product_allocation est une
// métadonnée de classification pure (module 4, préparation CBAM), elle ne
// touche jamais factor_code/quantity/period/scope et ne remet donc pas en
// cause l'immuabilité d'un résultat déjà calculé. Scopée par company_id
// comme tous les autres endpoints (section 7.1).
export async function setProductAllocation(companyId, entryId, productAllocation) {
  const result = await pool.query(
    `UPDATE activity_entries SET product_allocation = $1
     WHERE id = $2 AND company_id = $3 AND deleted_at IS NULL
     RETURNING id, product_allocation`,
    [productAllocation, entryId, companyId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'Entrée introuvable.');
  }
  return result.rows[0];
}

export async function siteIdsForCompany(companyId) {
  const result = await pool.query('SELECT id, name FROM sites WHERE company_id = $1', [
    companyId,
  ]);
  return result.rows;
}
