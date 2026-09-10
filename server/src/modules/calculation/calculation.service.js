import { pool, withTransaction } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { DIRECT_ENTRY_CATEGORIES, RAW_MATERIAL_FACTOR_CODE } from '../activity-entries/constants.js';
import { scope3RatioFactorCode, SCOPE3_RATIO_UNCERTAINTY } from './constants.js';

// Sélectionne la version du facteur valide PENDANT toute la période donnée
// (period_start/period_end de l'entrée ou de l'estimation Scope 3) — jamais
// "la version actuelle" (valid_to IS NULL) prise isolément. Un recalcul
// portant sur une période passée doit utiliser le facteur qui était en
// vigueur à cette période-là, même si une version plus récente existe
// depuis : c'est le principe même d'une table de facteurs versionnée.
async function getFactorForPeriod(code, categories, periodStart, periodEnd) {
  const result = await pool.query(
    `SELECT id, code, label, scope, category, unit, value_kgco2e, source, is_national
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
  if (factor) return { factor, error: null };
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
// Scope 1 & 2 — calcul batch, idempotent : ne calcule que les entrées qui
// n'ont pas encore de résultat. Ne recalcule jamais un résultat existant
// (exigence section 5 : "jamais un recalcul silencieux si le facteur
// change" — un résultat déjà produit référence la version exacte du facteur
// utilisée à ce moment-là, immuable).
// ============================================================
export async function runScopeOneTwoCalculation(companyId) {
  const pending = await pool.query(
    `SELECT ae.id, ae.factor_code, ae.quantity, ae.period_start, ae.period_end
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

  for (const entry of pending.rows) {
    const factor = await getFactorForPeriod(
      entry.factor_code,
      DIRECT_ENTRY_CATEGORIES,
      entry.period_start,
      entry.period_end,
    );
    if (!factor) {
      skippedNoFactor += 1;
      continue;
    }
    const tco2e = (Number(entry.quantity) * Number(factor.value_kgco2e)) / 1000;
    await pool.query(
      `INSERT INTO emission_results (activity_entry_id, emission_factor_id, scope, tco2e)
       VALUES ($1, $2, $3, $4)`,
      [entry.id, factor.id, factor.scope, tco2e],
    );
    calculated += 1;
  }

  return { calculated, skippedNoFactor, pending: pending.rows.length };
}

// Appelé juste après la création d'une entrée énergie (Module 2) pour que le
// résultat soit visible immédiatement, sans attendre un recalcul manuel.
export async function computeResultForEnergyEntry(entryId, factor) {
  const already = await pool.query('SELECT id FROM emission_results WHERE activity_entry_id = $1', [entryId]);
  if (already.rows.length > 0) return;

  const entry = await pool.query('SELECT quantity FROM activity_entries WHERE id = $1', [entryId]);
  const tco2e = (Number(entry.rows[0].quantity) * Number(factor.value_kgco2e)) / 1000;
  await pool.query(
    `INSERT INTO emission_results (activity_entry_id, emission_factor_id, scope, tco2e)
     VALUES ($1, $2, $3, $4)`,
    [entryId, factor.id, factor.scope, tco2e],
  );
}

// ============================================================
// Résumé agrégé (par scope, par site). Le Scope 2 est éclaté en
// location-based / market-based (double reporting obligatoire, section 5) ;
// tant qu'aucune entrée ne référence un facteur "electricite_market_based",
// le market-based affiché est identique au location-based par défaut, comme
// prévu par le brief ("sauf si contrat spécifique — non développé en V1").
// ============================================================
export async function getEmissionsSummary(companyId) {
  const rows = await pool.query(
    `SELECT er.scope, ef.category, ae.site_id, s.name AS site_name,
            ae.period_start, ae.period_end, ae.product_allocation, er.tco2e
     FROM emission_results er
     JOIN activity_entries ae ON ae.id = er.activity_entry_id
     JOIN emission_factors ef ON ef.id = er.emission_factor_id
     LEFT JOIN sites s ON s.id = ae.site_id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL`,
    [companyId],
  );

  const bySite = new Map();
  const byPeriod = new Map();
  const byProduct = new Map();
  let scope1 = 0;
  let scope2LocationBased = 0;
  let scope2MarketBased = 0;
  let scope3 = 0;
  let hasExplicitMarketBased = false;

  for (const row of rows.rows) {
    const tco2e = Number(row.tco2e);
    if (row.scope === 1) scope1 += tco2e;
    if (row.scope === 2 && row.category === 'electricite_location_based') scope2LocationBased += tco2e;
    if (row.scope === 2 && row.category === 'electricite_market_based') {
      scope2MarketBased += tco2e;
      hasExplicitMarketBased = true;
    }
    if (row.scope === 3) scope3 += tco2e;

    const siteKey = row.site_id ?? 'sans-site';
    if (!bySite.has(siteKey)) {
      bySite.set(siteKey, { siteId: row.site_id, siteName: row.site_name, totalTco2e: 0 });
    }
    bySite.get(siteKey).totalTco2e += tco2e;

    const periodKey = `${row.period_start}_${row.period_end}`;
    if (!byPeriod.has(periodKey)) {
      byPeriod.set(periodKey, { periodStart: row.period_start, periodEnd: row.period_end, totalTco2e: 0 });
    }
    byPeriod.get(periodKey).totalTco2e += tco2e;

    // "si allocation renseignée" (brief, section 5) : le Module 4 (CBAM) est
    // le seul à écrire product_allocation pour l'instant, donc ce regroupement
    // retombe entièrement dans le seau "non alloué" tant qu'il n'existe pas —
    // le mécanisme est prêt, pas encore alimenté.
    const productKey = row.product_allocation ?? 'non-alloue';
    if (!byProduct.has(productKey)) {
      byProduct.set(productKey, { productAllocation: row.product_allocation, totalTco2e: 0 });
    }
    byProduct.get(productKey).totalTco2e += tco2e;
  }

  return {
    scope1Tco2e: scope1,
    scope2LocationBasedTco2e: scope2LocationBased,
    scope2MarketBasedTco2e: hasExplicitMarketBased ? scope2MarketBased : scope2LocationBased,
    scope2MarketBasedIsDefaulted: !hasExplicitMarketBased,
    scope3Tco2e: scope3,
    scope3Uncertainty: scope3 > 0 ? SCOPE3_RATIO_UNCERTAINTY : null,
    bySite: [...bySite.values()],
    byPeriod: [...byPeriod.values()].sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1)),
    byProduct: [...byProduct.values()],
  };
}

// ============================================================
// Scope 3 — estimation spend-based (approche GHG Protocol, ratios ADEME
// Base Empreinte). Montant × ratio sectoriel, avec traçabilité complète du
// taux de change utilisé.
// ============================================================
export async function getScope3Readiness(companyId) {
  const sector = await getCompanySector(companyId);
  const today = todayIso();
  const [ratio, rate, nafMapping] = await Promise.all([
    getFactorForPeriod(scope3RatioFactorCode(sector), ['scope3_ratio'], today, today),
    getExchangeRateForPeriod(today, today),
    getSectorNafMapping(sector),
  ]);

  return {
    sector,
    sectorRatioAvailable: !!ratio,
    exchangeRateAvailable: !!rate,
    nafMapping,
    uncertainty: SCOPE3_RATIO_UNCERTAINTY,
  };
}

export async function estimateScope3(companyId, userId, { periodStart, periodEnd, amountMad }) {
  const sector = await getCompanySector(companyId);
  const [{ factor: ratio, error: ratioError }, { rate, error: rateError }] = await Promise.all([
    getFactorForPeriodOrExplain(scope3RatioFactorCode(sector), ['scope3_ratio'], periodStart, periodEnd),
    getExchangeRateForPeriodOrExplain(periodStart, periodEnd),
  ]);

  const missing = [ratioError, rateError].filter(Boolean);
  if (missing.length > 0) {
    throw new AppError(422, `Estimation Scope 3 impossible. ${missing.join(' ')}`);
  }

  const amountEur = amountMad / Number(rate.rate);
  const amountKeur = amountEur / 1000;
  const tco2e = (amountKeur * Number(ratio.value_kgco2e)) / 1000;

  return withTransaction(async (client) => {
    const entryResult = await client.query(
      `INSERT INTO activity_entries
         (company_id, site_id, period_start, period_end, factor_code, quantity, entered_by)
       VALUES ($1, NULL, $2, $3, $4, $5, $6)
       RETURNING id`,
      [companyId, periodStart, periodEnd, ratio.code, amountKeur, userId],
    );
    const entryId = entryResult.rows[0].id;

    const resultInsert = await client.query(
      `INSERT INTO emission_results (activity_entry_id, emission_factor_id, scope, tco2e, exchange_rate_id)
       VALUES ($1, $2, 3, $3, $4)
       RETURNING id, tco2e, calculated_at`,
      [entryId, ratio.id, tco2e, rate.id],
    );

    return {
      entryId,
      resultId: resultInsert.rows[0].id,
      tco2e: Number(resultInsert.rows[0].tco2e),
      calculatedAt: resultInsert.rows[0].calculated_at,
      amountMad,
      amountEur,
      amountKeur,
      ratioUsed: { code: ratio.code, valueKgco2ePerKeur: Number(ratio.value_kgco2e), source: ratio.source },
      rateUsed: { rate: Number(rate.rate), source: rate.source, validFrom: rate.valid_from },
      uncertainty: SCOPE3_RATIO_UNCERTAINTY,
    };
  });
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
