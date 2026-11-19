import { pool, withTransaction } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  ALL_ENTRY_CATEGORIES,
  RAW_MATERIAL_FACTOR_CODE,
  SCOPE1_ALLOWED_BOUNDARIES,
  UNUSABLE_METHOD_STATUSES,
  SCOPE1_CATEGORY_LABELS,
  SCOPE3_CATEGORY_LABELS,
} from '../activity-entries/constants.js';
import { scope3RatioFactorCode } from './constants.js';
import { determineAggregateStatus } from '../reports/report-formatting.js';
import { computeMarketBased } from '../electricity/market-based.service.js';
import { getSourceRelevance } from '../methodology/coverage.service.js';

export const FACTOR_COLUMNS = `id, code, label, scope, category, unit, value_kgco2e, source, is_national,
  valid_from, valid_to, factor_uid, version_label, activity_label, gases_covered, gwp_reference, geography,
  technology, represented_year, publication_date, integration_date, boundary, source_original, source_file,
  source_sheet, source_cell, uncertainty_pct, usage_restrictions, validity_note, methodological_status,
  rights_status, scope3_category, corrects_factor_id`;

// Dernière correction enregistrée d'une version de facteur (chaîne suivie
// jusqu'au bout). Réservé au recalcul de l'année de référence.
export async function resolveCorrectedFactor(factor, client = pool) {
  let current = factor;
  for (let i = 0; i < 20; i += 1) {
    const r = await client.query(
      `SELECT ${FACTOR_COLUMNS} FROM emission_factors WHERE corrects_factor_id = $1 ORDER BY id DESC LIMIT 1`,
      [current.id],
    );
    if (r.rows.length === 0) return current;
    current = r.rows[0];
  }
  return current;
}

// Garde-fou méthodologique, appliqué à TOUTE production de résultat : un
// facteur retiré / non utilisable ne calcule rien, et un facteur dont le
// périmètre n'est pas « combustion seule », « procédé » ou « fugitif » ne
// peut jamais produire un résultat Scope 1 (un facteur combustion + amont
// gonflerait le Scope 1 de la part amont, qui relève du Scope 3).
export function factorUsabilityError(factor) {
  if (UNUSABLE_METHOD_STATUSES.includes(factor.methodological_status)) {
    return `Le facteur « ${factor.label} » est marqué « ${factor.methodological_status === 'retire' ? 'retiré' : 'non utilisable'} » dans le registre : ${factor.usage_restrictions ?? 'voir le registre des facteurs.'}`;
  }
  if (factor.scope === 1 && factor.boundary && !SCOPE1_ALLOWED_BOUNDARIES.includes(factor.boundary)) {
    return `Le facteur « ${factor.label} » couvre le périmètre « ${factor.boundary} » : il ne permet pas de calculer des émissions Scope 1 (combustion seule, procédé ou fuite requis). Aucune répartition n'est estimée à sa place.`;
  }
  return null;
}

// Sélectionne la version du facteur valide PENDANT toute la période donnée
// (period_start/period_end de l'entrée ou de l'estimation Scope 3) — jamais
// "la version actuelle" (valid_to IS NULL) prise isolément. Un recalcul
// portant sur une période passée doit utiliser le facteur qui était en
// vigueur à cette période-là, même si une version plus récente existe
// depuis : c'est le principe même d'une table de facteurs versionnée.
export async function getFactorForPeriod(code, categories, periodStart, periodEnd, client = pool) {
  const result = await client.query(
    `SELECT ${FACTOR_COLUMNS}
     FROM emission_factors
     WHERE code = $1 AND category = ANY($2)
       AND valid_from <= $3
       AND (valid_to IS NULL OR valid_to >= $4)
     ORDER BY valid_from DESC LIMIT 1`,
    [code, categories, periodStart, periodEnd],
  );
  return result.rows[0] || null;
}

async function getExchangeRateForPeriod(periodStart, periodEnd) {
  const result = await pool.query(
    `SELECT id, base_currency, quote_currency, rate, source, valid_from
     FROM exchange_rates
     WHERE valid_from <= $1
       AND (valid_to IS NULL OR valid_to >= $2)
     ORDER BY valid_from DESC LIMIT 1`,
    [periodStart, periodEnd],
  );
  return result.rows[0] || null;
}

// Utilisé uniquement pour l'indicateur de disponibilité affiché avant que
// l'utilisateur ait choisi une période (readiness) : "existe-t-il une
// version active aujourd'hui ?". Ce n'est qu'un indice pour l'UI — la
// sélection réellement utilisée par un calcul passe toujours par
// getFactorForPeriod/getExchangeRateForPeriod avec la vraie période saisie.
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateRange(validFrom, validTo) {
  return `du ${validFrom} au ${validTo ?? "aujourd'hui"}`;
}

// Quand aucune version ne couvre l'intégralité de la période, il faut
// distinguer deux situations pour que le message soit actionnable :
//  - aucune version ne chevauche même partiellement la période -> le
//    facteur n'est simplement pas disponible pour cette période ;
//  - une ou plusieurs versions la chevauchent partiellement -> la période
//    traverse un changement de version, l'utilisateur doit scinder sa
//    saisie en plusieurs entrées, une par tronçon de validité.
// Jamais le même message générique pour ces deux cas.
async function explainMissingFactor(code, categories, periodStart, periodEnd) {
  const overlapping = await pool.query(
    `SELECT valid_from, valid_to FROM emission_factors
     WHERE code = $1 AND category = ANY($2)
       AND valid_from <= $4 AND (valid_to IS NULL OR valid_to >= $3)
     ORDER BY valid_from`,
    [code, categories, periodStart, periodEnd],
  );

  if (overlapping.rows.length === 0) {
    return `Aucune version du facteur "${code}" n'est disponible pour la période du ${periodStart} au ${periodEnd}.`;
  }

  const versions = overlapping.rows.map((v) => formatDateRange(v.valid_from, v.valid_to)).join(' , puis ');
  return (
    `Le facteur "${code}" change de version pendant la période sélectionnée ` +
    `(versions disponibles : ${versions}) — aucune ne couvre l'intégralité du ${periodStart} au ${periodEnd}. ` +
    `Scindez votre saisie en plusieurs entrées, une par tronçon de période encadré par les dates de changement.`
  );
}

async function explainMissingExchangeRate(periodStart, periodEnd) {
  const overlapping = await pool.query(
    `SELECT valid_from, valid_to FROM exchange_rates
     WHERE valid_from <= $2 AND (valid_to IS NULL OR valid_to >= $1)
     ORDER BY valid_from`,
    [periodStart, periodEnd],
  );

  if (overlapping.rows.length === 0) {
    return `Aucun taux de change EUR/MAD n'est disponible pour la période du ${periodStart} au ${periodEnd}.`;
  }

  const versions = overlapping.rows.map((v) => formatDateRange(v.valid_from, v.valid_to)).join(' , puis ');
  return (
    `Le taux de change EUR/MAD change pendant la période sélectionnée ` +
    `(taux disponibles : ${versions}) — aucun ne couvre l'intégralité du ${periodStart} au ${periodEnd}. ` +
    `Scindez votre estimation en plusieurs saisies, une par tronçon de période encadré par les dates de changement.`
  );
}

// Combine la sélection stricte (période entièrement couverte) et, en cas
// d'échec, un message d'erreur qui explique précisément pourquoi — jamais un
// message générique. Utilisé par la saisie Module 2 et l'estimation Scope 3.
export async function getFactorForPeriodOrExplain(code, categories, periodStart, periodEnd) {
  const factor = await getFactorForPeriod(code, categories, periodStart, periodEnd);
  if (factor) {
    const usabilityError = factorUsabilityError(factor);
    if (usabilityError) return { factor: null, error: usabilityError };
    return { factor, error: null };
  }
  return { factor: null, error: await explainMissingFactor(code, categories, periodStart, periodEnd) };
}

export async function getExchangeRateForPeriodOrExplain(periodStart, periodEnd) {
  const rate = await getExchangeRateForPeriod(periodStart, periodEnd);
  if (rate) return { rate, error: null };
  return { rate: null, error: await explainMissingExchangeRate(periodStart, periodEnd) };
}

export async function getSectorNafMapping(sector) {
  const result = await pool.query(
    `SELECT sector, naf_code_reference, naf_label, notes FROM sector_naf_mapping WHERE sector = $1`,
    [sector],
  );
  return result.rows[0] || null;
}

async function getCompanySector(companyId) {
  const result = await pool.query('SELECT sector FROM companies WHERE id = $1', [companyId]);
  if (result.rows.length === 0) throw new AppError(404, 'Entreprise introuvable.');
  return result.rows[0].sector;
}


// ============================================================
// Calcul batch, idempotent : ne calcule que les entrées qui n'ont pas encore
// de résultat. Ne recalcule jamais un résultat existant ("jamais un recalcul
// silencieux si le facteur change") : un résultat déjà produit référence la
// version exacte du facteur utilisée à ce moment-là, immuable.
// ============================================================
export async function runScopeOneTwoCalculation(companyId) {
  const pending = await pool.query(
    `SELECT ae.id, ae.factor_code, ae.quantity, ae.period_start, ae.period_end, ae.scope3_category
     FROM activity_entries ae
     LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
     WHERE ae.company_id = $1
       AND ae.deleted_at IS NULL
       AND er.id IS NULL
       AND ae.factor_code != $2
       AND ae.factor_code NOT LIKE 'scope3_ratio_%'`,
    [companyId, RAW_MATERIAL_FACTOR_CODE],
  );

  let calculated = 0;
  let skippedNoFactor = 0;
  let skippedUnusableFactor = 0;

  for (const entry of pending.rows) {
    const factor = await getFactorForPeriod(entry.factor_code, ALL_ENTRY_CATEGORIES, entry.period_start, entry.period_end);
    if (!factor) {
      skippedNoFactor += 1;
      continue;
    }
    if (factorUsabilityError(factor)) {
      skippedUnusableFactor += 1;
      continue;
    }
    await insertResult(pool, entry.id, factor, Number(entry.quantity));
    calculated += 1;
  }

  return { calculated, skippedNoFactor, skippedUnusableFactor, pending: pending.rows.length };
}

// tCO2e = quantité (dans l'unité du facteur) × facteur (kgCO2e/unité) / 1000.
// Pour un facteur en kgCO2e/kMAD, la quantité est déjà exprimée en kMAD
// (montant MAD / 1000) : aucune conversion de devise n'est appliquée.
export function computeTco2e(quantity, factorValueKg) {
  return (Number(quantity) * Number(factorValueKg)) / 1000;
}

async function insertResult(client, entryId, factor, quantity) {
  const tco2e = computeTco2e(quantity, factor.value_kgco2e);
  await client.query(
    `INSERT INTO emission_results (activity_entry_id, emission_factor_id, scope, tco2e)
     VALUES ($1, $2, $3, $4)`,
    [entryId, factor.id, factor.scope, tco2e],
  );
}

// Appelé juste après la création d'une entrée (Module 2) pour que le
// résultat soit visible immédiatement, sans attendre un recalcul manuel.
export async function computeResultForEnergyEntry(entryId, factor) {
  const already = await pool.query('SELECT id FROM emission_results WHERE activity_entry_id = $1', [entryId]);
  if (already.rows.length > 0) return;
  const usabilityError = factorUsabilityError(factor);
  if (usabilityError) throw new AppError(400, usabilityError);
  const entry = await pool.query('SELECT quantity FROM activity_entries WHERE id = $1', [entryId]);
  await insertResult(pool, entryId, factor, Number(entry.rows[0].quantity));
}

// ============================================================
// Statut par poste — jamais déduit du seul booléen "a des données" : une
// entrée saisie mais jamais calculée (facteur manquant ou inutilisable)
// compte dans entryCount sans compter dans calculatedCount, ce qui distingue
// "non_calcule" de "manquant". Le scope/la catégorie d'une entrée non
// calculée est retrouvé via le catalogue emission_factors par factor_code.
// ============================================================
function emptyBucket() {
  return { entryCount: 0, calculatedCount: 0, sumTco2e: 0, hasPartialInternalControl: false };
}

async function getEntryClassification(companyId) {
  const result = await pool.query(
    `SELECT ae.id, ae.scope3_category AS entry_scope3_category,
            er.tco2e, er.verification_status,
            COALESCE(result_ef.scope, catalog_ef.scope) AS scope,
            COALESCE(result_ef.category, catalog_ef.category) AS category,
            COALESCE(result_ef.scope3_category, catalog_ef.scope3_category) AS factor_scope3_category
     FROM activity_entries ae
     LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
     LEFT JOIN emission_factors result_ef ON result_ef.id = er.emission_factor_id
     LEFT JOIN LATERAL (
       SELECT scope, category, scope3_category FROM emission_factors ef2
       WHERE ef2.code = ae.factor_code
       ORDER BY ef2.valid_from DESC
       LIMIT 1
     ) catalog_ef ON true
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL AND ae.material_label IS NULL`,
    [companyId],
  );

  const scope1 = emptyBucket();
  const scope1ByCategory = Object.fromEntries(Object.keys(SCOPE1_CATEGORY_LABELS).map((k) => [k, emptyBucket()]));
  const scope2LocationBased = emptyBucket();
  const scope2LegacyMarketBased = emptyBucket();
  const scope3 = emptyBucket();
  const scope3ByCategory = {};
  // Ancienne méthode du ratio sectoriel global : isolée, JAMAIS additionnée
  // au Scope 3 par catégorie (elle couvrirait les mêmes dépenses).
  const legacyScope3Ratio = emptyBucket();
  let legacyScope3RatioCount = 0;

  for (const row of result.rows) {
    const buckets = [];
    if (row.scope === 1) {
      buckets.push(scope1);
      if (scope1ByCategory[row.category]) buckets.push(scope1ByCategory[row.category]);
    } else if (row.scope === 2 && row.category === 'electricite_location_based') {
      buckets.push(scope2LocationBased);
    } else if (row.scope === 2 && row.category === 'electricite_market_based') {
      buckets.push(scope2LegacyMarketBased);
    } else if (row.scope === 3 && row.category === 'scope3_ratio') {
      legacyScope3RatioCount += 1;
      buckets.push(legacyScope3Ratio);
    } else if (row.scope === 3) {
      buckets.push(scope3);
      const cat = row.entry_scope3_category ?? row.factor_scope3_category ?? null;
      const key = cat ?? 'non_classee';
      if (!scope3ByCategory[key]) scope3ByCategory[key] = emptyBucket();
      buckets.push(scope3ByCategory[key]);
    }
    // scope/catégorie indéterminés : n'entre dans aucun poste, jamais compté au hasard.
    for (const bucket of buckets) {
      bucket.entryCount += 1;
      if (row.tco2e !== null) {
        bucket.calculatedCount += 1;
        bucket.sumTco2e += Number(row.tco2e);
        if (row.verification_status === 'controle_interne_partiel') bucket.hasPartialInternalControl = true;
      }
    }
  }

  return { scope1, scope1ByCategory, scope2LocationBased, scope2LegacyMarketBased, scope3, scope3ByCategory, legacyScope3RatioCount, legacyScope3Ratio };
}

function statusOf(bucket, options = {}) {
  return determineAggregateStatus({
    entryCount: bucket.entryCount,
    calculatedCount: bucket.calculatedCount,
    sumTco2e: bucket.sumTco2e,
    hasPartialInternalControl: bucket.hasPartialInternalControl,
    ...options,
  });
}

export async function getEmissionsSummary(companyId) {
  const [rows, classification, marketBased, relevance] = await Promise.all([
    pool.query(
      `SELECT er.scope, ef.category, ae.site_id, s.name AS site_name,
              ae.period_start, ae.period_end, ae.product_allocation, er.tco2e
       FROM emission_results er
       JOIN activity_entries ae ON ae.id = er.activity_entry_id
       JOIN emission_factors ef ON ef.id = er.emission_factor_id
       LEFT JOIN sites s ON s.id = ae.site_id
       WHERE ae.company_id = $1 AND ae.deleted_at IS NULL`,
      [companyId],
    ),
    getEntryClassification(companyId),
    computeMarketBased(companyId),
    getSourceRelevance(companyId),
  ]);

  // Agrégations par site / période / produit : Scope 1 + Scope 2
  // location-based + Scope 3 calculé. Le market-based n'y entre JAMAIS
  // (deux méthodes Scope 2 ne s'additionnent pas).
  const bySite = new Map();
  const byPeriod = new Map();
  const byProduct = new Map();

  for (const row of rows.rows) {
    if (row.scope === 2 && row.category !== 'electricite_location_based') continue;
    if (row.category === 'scope3_ratio') continue; // méthode isolée, hors agrégats
    const tco2e = Number(row.tco2e);

    const siteKey = row.site_id ?? 'sans-site';
    if (!bySite.has(siteKey)) bySite.set(siteKey, { siteId: row.site_id, siteName: row.site_name, totalTco2e: 0 });
    bySite.get(siteKey).totalTco2e += tco2e;

    const periodKey = `${row.period_start}_${row.period_end}`;
    if (!byPeriod.has(periodKey)) byPeriod.set(periodKey, { periodStart: row.period_start, periodEnd: row.period_end, totalTco2e: 0 });
    byPeriod.get(periodKey).totalTco2e += tco2e;

    const productKey = row.product_allocation ?? 'non-alloue';
    if (!byProduct.has(productKey)) byProduct.set(productKey, { productAllocation: row.product_allocation, totalTco2e: 0 });
    byProduct.get(productKey).totalTco2e += tco2e;
  }

  const scope1Status = statusOf(classification.scope1);
  const scope2LocationBasedStatus = statusOf(classification.scope2LocationBased);
  const scope3Status = statusOf(classification.scope3, { isEstimation: true });

  const scope1Breakdown = Object.entries(classification.scope1ByCategory).map(([category, bucket]) => ({
    category,
    label: SCOPE1_CATEGORY_LABELS[category],
    tco2e: bucket.calculatedCount > 0 ? bucket.sumTco2e : null,
    entryCount: bucket.entryCount,
    calculatedCount: bucket.calculatedCount,
    ...statusOf(bucket),
  }));

  const scope3Breakdown = Object.entries(SCOPE3_CATEGORY_LABELS).map(([cat, label]) => {
    const bucket = classification.scope3ByCategory[cat] ?? emptyBucket();
    const rel = relevance.find((r) => r.sourceCode === `S3_C${cat}`);
    return {
      category: Number(cat),
      label,
      tco2e: bucket.calculatedCount > 0 ? bucket.sumTco2e : null,
      relevance: rel?.status ?? 'a_evaluer',
      relevanceJustification: rel?.justification ?? null,
      entryCount: bucket.entryCount,
      calculatedCount: bucket.calculatedCount,
      ...statusOf(bucket, { isEstimation: true }),
    };
  });
  const scope3Coverage = {
    categoriesWithData: scope3Breakdown.filter((c) => c.calculatedCount > 0).length,
    categoriesRelevant: scope3Breakdown.filter((c) => c.relevance === 'pertinente').length,
    categoriesNotRelevant: scope3Breakdown.filter((c) => c.relevance === 'non_pertinente').length,
    relevantMissing: scope3Breakdown
      .filter((c) => c.relevance !== 'non_pertinente' && c.calculatedCount === 0)
      .map((c) => ({ category: c.category, label: c.label, relevance: c.relevance })),
    // Jamais « complet » : au mieux, toutes les catégories jugées pertinentes
    // par l'entreprise sont renseignées.
    isPartial: true,
  };

  return {
    scope1Tco2e: classification.scope1.sumTco2e,
    scope1Status,
    scope1Breakdown,
    scope2LocationBasedTco2e: classification.scope2LocationBased.sumTco2e,
    scope2LocationBasedStatus,
    scope2MarketBasedTco2e: marketBased.totalTco2e,
    scope2MarketBasedStatus: marketBased.status,
    scope2MarketBased: marketBased,
    // Conservé pour compatibilité : vrai quand aucun instrument contractuel
    // admissible n'est appliqué (market-based = facteur réseau par défaut).
    scope2MarketBasedIsDefaulted: marketBased.admissibleKwh === 0,
    scope3Tco2e: classification.scope3.sumTco2e,
    scope3Status,
    scope3Breakdown,
    scope3Coverage,
    scope3Uncertainty: null,
    legacyScope3RatioCount: classification.legacyScope3RatioCount,
    // Affiché à part pour information, exclu de tout total.
    legacyScope3Ratio: {
      entryCount: classification.legacyScope3Ratio.entryCount,
      tco2e: classification.legacyScope3Ratio.calculatedCount > 0 ? classification.legacyScope3Ratio.sumTco2e : null,
      note: "Estimations historiques par ratio sectoriel global : méthode isolée, exclue des totaux pour éviter un double comptage avec les achats par catégorie.",
    },
    bySite: [...bySite.values()],
    byPeriod: [...byPeriod.values()].sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1)),
    byProduct: [...byProduct.values()],
  };
}

// ============================================================
// Ancienne méthode « ratio sectoriel global » (ratio lié au secteur de
// l'entreprise appliqué à toutes ses dépenses) : ISOLÉE. Les lignes de
// ratio sont retirées du registre ; les points d'entrée restent pour lire
// d'éventuelles estimations historiques et répondre explicitement que la
// méthode n'est plus proposée.
// ============================================================
export async function getScope3Readiness(companyId) {
  const sector = await getCompanySector(companyId);
  return {
    sector,
    method: 'achats_par_categorie',
    legacySectorRatio: {
      code: scope3RatioFactorCode(sector),
      available: false,
      reason: "Méthode du ratio sectoriel global isolée : le Scope 3 se saisit par catégorie d'achat, avec un facteur choisi et justifié ligne par ligne.",
    },
  };
}

export async function estimateScope3() {
  throw new AppError(
    410,
    "L'estimation Scope 3 par ratio sectoriel global n'est plus proposée. Saisissez vos achats par catégorie (données d'activité → Scope 3), avec un facteur adapté à chaque catégorie.",
  );
}

export async function listScope3Estimates(companyId) {
  const result = await pool.query(
    `SELECT ae.id AS entry_id, ae.period_start, ae.period_end, ae.quantity AS amount_keur,
            er.tco2e, er.calculated_at, ef.label, ex.rate, ex.source AS rate_source
     FROM activity_entries ae
     JOIN emission_results er ON er.activity_entry_id = ae.id
     JOIN emission_factors ef ON ef.id = er.emission_factor_id
     LEFT JOIN exchange_rates ex ON ex.id = er.exchange_rate_id
     WHERE ae.company_id = $1 AND ae.factor_code LIKE 'scope3_ratio_%' AND ae.deleted_at IS NULL
     ORDER BY ae.period_start DESC`,
    [companyId],
  );
  return result.rows;
}

