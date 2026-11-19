import { pool } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  RAW_MATERIAL_FACTOR_CODE,
  ALL_ENTRY_CATEGORIES,
  DEFAULT_SCOPE3_CATEGORY,
  UNUSABLE_METHOD_STATUSES,
  SCOPE1_ALLOWED_BOUNDARIES,
} from './constants.js';
import { computeResultForEnergyEntry, getFactorForPeriodOrExplain } from '../calculation/calculation.service.js';

const ALLOWED_SCOPE3_CATEGORIES = {
  scope3_achat_physique: [1, 2],
  scope3_achat_monetaire: [1, 2],
  scope3_immobilisation: [2],
  scope3_dechets: [5],
  scope3_pertes_reseau: [3],
  scope3_fret: [4, 9],
};

// Traduit la saisie en quantité dans l'unité du facteur, avec les contrôles
// propres à chaque catégorie. Ne fait JAMAIS de conversion de devise.
export function resolveQuantity(factor, data) {
  const unit = String(factor.unit).toLowerCase();
  if (factor.category === 'scope3_achat_monetaire' || unit === 'kmad') {
    if (unit !== 'kmad') throw new AppError(400, `Ce facteur est exprimé par ${factor.unit} : la conversion n'est pas prise en charge.`);
    if (!data.amountMad) throw new AppError(400, 'Indiquez le montant de la dépense en MAD (HT).');
    if (!data.factorJustification || data.factorJustification.length < 10) {
      throw new AppError(400, "Un ratio monétaire doit être choisi et justifié pour cette catégorie d'achat (pourquoi ce facteur est adapté).");
    }
    return { quantity: data.amountMad / 1000, amountMad: data.amountMad };
  }
  if (factor.category === 'scope3_fret' && unit === 'tonne.km') {
    if (!data.massTonnes || !data.distanceKm) throw new AppError(400, 'Indiquez la masse transportée (t) et la distance (km) : quantité = t × km.');
    return { quantity: data.massTonnes * data.distanceKm, massTonnes: data.massTonnes, distanceKm: data.distanceKm };
  }
  if (!data.quantity) throw new AppError(400, `Indiquez la quantité dans l'unité du facteur (${factor.unit}).`);
  return { quantity: data.quantity };
}

export function resolveScope3Category(factor, requested) {
  if (factor.scope !== 3) return null;
  const allowed = ALLOWED_SCOPE3_CATEGORIES[factor.category];
  if (!allowed) throw new AppError(400, 'Catégorie de facteur Scope 3 non saisissable ligne par ligne.');
  if (requested === undefined || requested === null) {
    const fallback = factor.scope3_category ?? DEFAULT_SCOPE3_CATEGORY[factor.category];
    if (!fallback) throw new AppError(400, `Précisez la catégorie Scope 3 (${allowed.join(' ou ')}).`);
    return fallback;
  }
  if (!allowed.includes(requested)) throw new AppError(400, `Catégorie Scope 3 ${requested} incompatible avec ce facteur (attendu : ${allowed.join(' ou ')}).`);
  return requested;
}

async function assertSiteOwnedByCompany(companyId, siteId) {
  const result = await pool.query('SELECT id FROM sites WHERE id = $1 AND company_id = $2', [
    siteId,
    companyId,
  ]);
  if (result.rows.length === 0) {
    throw new AppError(400, "Ce site n'existe pas ou n'appartient pas à votre entreprise.");
  }
}

// Facteurs proposés à la saisie : versions courantes, utilisables (jamais un
// facteur retiré / non utilisable, ni un facteur Scope 1 hors périmètre
// combustion seule / procédé / fuite), avec leurs métadonnées de registre.
export async function listAvailableFactors() {
  const result = await pool.query(
    `SELECT id, code, label, scope, category, unit, value_kgco2e, source, is_national, scope3_category,
            boundary, represented_year, uncertainty_pct, usage_restrictions, methodological_status, rights_status,
            source_sheet, source_cell, gwp_reference
     FROM emission_factors
     WHERE category = ANY($1) AND valid_to IS NULL
       AND methodological_status <> ALL($2)
       AND (scope <> 1 OR boundary IS NULL OR boundary = ANY($3))
     ORDER BY scope, category, label`,
    [ALL_ENTRY_CATEGORIES, UNUSABLE_METHOD_STATUSES, SCOPE1_ALLOWED_BOUNDARIES],
  );
  return result.rows;
}

export async function createEnergyEntry(companyId, userId, data) {
  if (data.siteId) await assertSiteOwnedByCompany(companyId, data.siteId);

  // La sélection compare valid_from/valid_to du facteur à period_start/
  // period_end de l'entrée (jamais "valid_to IS NULL" isolément) — voir
  // calculation.service.js pour le détail. Si la période traverse un
  // changement de version, le message explique précisément pourquoi plutôt
  // qu'un message générique.
  const { factor, error } = await getFactorForPeriodOrExplain(
    data.factorCode,
    ALL_ENTRY_CATEGORIES,
    data.periodStart,
    data.periodEnd,
  );
  if (!factor) {
    throw new AppError(400, error);
  }
  if (factor.scope !== 3 && !data.siteId) {
    throw new AppError(400, 'Le site est obligatoire pour une donnée Scope 1 ou Scope 2.');
  }

  const resolved = resolveQuantity(factor, data);
  const scope3Category = resolveScope3Category(factor, data.scope3Category);

  const result = await pool.query(
    `INSERT INTO activity_entries
       (company_id, site_id, period_start, period_end, factor_code, quantity, source_document, entered_by,
        scope3_category, amount_mad, mass_tonnes, distance_km, data_origin, description, factor_justification)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id, site_id, period_start, period_end, factor_code, quantity, source_document, created_at,
               scope3_category, amount_mad, mass_tonnes, distance_km, data_origin, description, factor_justification`,
    [
      companyId,
      data.siteId ?? null,
      data.periodStart,
      data.periodEnd,
      data.factorCode,
      resolved.quantity,
      data.sourceDocument ?? null,
      userId,
      scope3Category,
      resolved.amountMad ?? null,
      resolved.massTonnes ?? null,
      resolved.distanceKm ?? null,
      data.dataOrigin ?? null,
      data.description ?? null,
      data.factorJustification ?? null,
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
            ae.product_allocation, ae.source_document, ae.created_at,
            ae.scope3_category, ae.amount_mad, ae.mass_tonnes, ae.distance_km, ae.data_origin,
            ae.description, ae.factor_justification, ae.internal_control_status, ae.internal_control_note,
            er.tco2e, ef.label AS factor_label, ef.unit AS factor_unit, ef.scope AS factor_scope,
            ef.category AS factor_category
     FROM activity_entries ae
     LEFT JOIN sites s ON s.id = ae.site_id
     LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
     LEFT JOIN emission_factors ef ON ef.id = er.emission_factor_id
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
