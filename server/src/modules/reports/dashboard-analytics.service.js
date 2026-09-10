import { pool } from '../../config/db.js';
import { simulateCarbonTax } from '../financing/financing.service.js';

const REPORTING_INTERVAL_DAYS = {
  mensuelle: 31,
  trimestrielle: 92,
  annuelle: 366,
};

async function getCompany(companyId) {
  const result = await pool.query(
    `SELECT id, name, base_year, annual_revenue_mad, reporting_frequency, created_at
     FROM companies WHERE id = $1`,
    [companyId],
  );
  return result.rows[0] || null;
}

async function getActiveThresholds() {
  const result = await pool.query(
    `SELECT code, threshold_value, unit FROM alert_thresholds WHERE active = true`,
  );
  const byCode = new Map(result.rows.map((r) => [r.code, Number(r.threshold_value)]));
  return byCode;
}

// ============================================================
// Totaux Scope 1+2 par année civile (année du period_start) — sert à la fois
// à "variation vs année de référence" et à "intensité carbone" (bandeau de
// synthèse). Jamais le Scope 3 : même discipline que le simulateur taxe
// carbone et le dashboard existant, qui ne fondent jamais Scope 3 dans un total.
// ============================================================
async function getYearlyScope12Totals(companyId) {
  const result = await pool.query(
    `SELECT EXTRACT(YEAR FROM ae.period_start)::int AS year, SUM(er.tco2e) AS total
     FROM emission_results er
     JOIN activity_entries ae ON ae.id = er.activity_entry_id
     JOIN emission_factors ef ON ef.id = er.emission_factor_id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
       AND (er.scope = 1 OR (er.scope = 2 AND ef.category = 'electricite_location_based'))
     GROUP BY year
     ORDER BY year`,
    [companyId],
  );
  return result.rows.map((r) => ({ year: r.year, totalTco2e: Number(r.total) }));
}

// "Variation vs année de référence" et "Intensité carbone" utilisent tous
// deux l'année civile la plus récente disposant de données (pas un cumul
// depuis toujours, qui grossirait mécaniquement avec le temps et rendrait la
// comparaison trompeuse). Nécessite au moins une année différente de
// l'année de référence pour être significatif — sinon "pas encore assez
// de recul", jamais un 0% fabriqué.
function resolveYearlyComparison(yearlyTotals, baseYear) {
  if (yearlyTotals.length === 0) return { available: false, reason: 'no_data' };
  const mostRecent = yearlyTotals[yearlyTotals.length - 1];
  if (baseYear === null || baseYear === undefined) {
    return { available: false, reason: 'base_year_not_set', mostRecentYear: mostRecent };
  }
  const baseYearRow = yearlyTotals.find((y) => y.year === baseYear);
  if (!baseYearRow || baseYearRow.totalTco2e === 0) {
    return { available: false, reason: 'base_year_no_data', mostRecentYear: mostRecent };
  }
  if (mostRecent.year === baseYear) {
    return { available: false, reason: 'insufficient_history', mostRecentYear: mostRecent };
  }
  const variationPct = ((mostRecent.totalTco2e - baseYearRow.totalTco2e) / baseYearRow.totalTco2e) * 100;
  return {
    available: true,
    mostRecentYear: mostRecent,
    baseYear: baseYearRow,
    variationPct,
  };
}

// ============================================================
// Top 5 postes d'émission (par factor_code), tous scopes et sites confondus
// — "où agir en premier" (spec section 2.D).
// ============================================================
export async function getTopContributors(companyId, limit = 5) {
  const [rows, grandTotalResult] = await Promise.all([
    pool.query(
      `SELECT ae.factor_code, ef.label, er.scope, SUM(er.tco2e) AS total_tco2e
       FROM emission_results er
       JOIN activity_entries ae ON ae.id = er.activity_entry_id
       JOIN emission_factors ef ON ef.id = er.emission_factor_id
       WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
       GROUP BY ae.factor_code, ef.label, er.scope
       ORDER BY total_tco2e DESC
       LIMIT $2`,
      [companyId, limit],
    ),
    pool.query(
      `SELECT COALESCE(SUM(er.tco2e), 0) AS total
       FROM emission_results er
       JOIN activity_entries ae ON ae.id = er.activity_entry_id
       WHERE ae.company_id = $1 AND ae.deleted_at IS NULL`,
      [companyId],
    ),
  ]);

  const grandTotal = Number(grandTotalResult.rows[0].total);
  return rows.rows.map((r) => ({
    factorCode: r.factor_code,
    label: r.label,
    scope: r.scope,
    totalTco2e: Number(r.total_tco2e),
    pctOfTotal: grandTotal > 0 ? (Number(r.total_tco2e) / grandTotal) * 100 : 0,
  }));
}

// ============================================================
// Qualité méthodologique (spec section 2.E) : % facteurs nationaux pondéré
// tCO2e, répartition verification_status, et la même part nationale dans le
// temps (nécessaire à l'alarme "chute de la part de facteurs nationaux").
// ============================================================
export async function getQualityMetrics(companyId) {
  const [overall, byStatus, byPeriod] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(er.tco2e) FILTER (WHERE ef.is_national), 0) AS national_tco2e,
         COALESCE(SUM(er.tco2e), 0) AS total_tco2e
       FROM emission_results er
       JOIN activity_entries ae ON ae.id = er.activity_entry_id
       JOIN emission_factors ef ON ef.id = er.emission_factor_id
       WHERE ae.company_id = $1 AND ae.deleted_at IS NULL`,
      [companyId],
    ),
    pool.query(
      `SELECT er.verification_status, SUM(er.tco2e) AS total_tco2e
       FROM emission_results er
       JOIN activity_entries ae ON ae.id = er.activity_entry_id
       WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
       GROUP BY er.verification_status`,
      [companyId],
    ),
    pool.query(
      `SELECT ae.period_start, ae.period_end,
              COALESCE(SUM(er.tco2e) FILTER (WHERE ef.is_national), 0) AS national_tco2e,
              SUM(er.tco2e) AS total_tco2e
       FROM emission_results er
       JOIN activity_entries ae ON ae.id = er.activity_entry_id
       JOIN emission_factors ef ON ef.id = er.emission_factor_id
       WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
       GROUP BY ae.period_start, ae.period_end
       ORDER BY ae.period_start`,
      [companyId],
    ),
  ]);

  const totalTco2e = Number(overall.rows[0].total_tco2e);
  const nationalTco2e = Number(overall.rows[0].national_tco2e);

  const verificationBreakdown = byStatus.rows.map((r) => ({
    status: r.verification_status,
    tco2e: Number(r.total_tco2e),
    pctOfTotal: totalTco2e > 0 ? (Number(r.total_tco2e) / totalTco2e) * 100 : 0,
  }));

  const byPeriodNationalShare = byPeriod.rows.map((r) => {
    const periodTotal = Number(r.total_tco2e);
    return {
      periodStart: r.period_start,
      periodEnd: r.period_end,
      nationalSharePct: periodTotal > 0 ? (Number(r.national_tco2e) / periodTotal) * 100 : null,
    };
  });

  return {
    nationalSharePct: totalTco2e > 0 ? (nationalTco2e / totalTco2e) * 100 : null,
    verificationBreakdown,
    byPeriodNationalShare,
  };
}

// ============================================================
// Série par site × période, triée chronologiquement par site — sert au
// graphique de détail et à l'alarme "variation anormale MoM par site".
// ============================================================
export async function getSiteMoMSeries(companyId) {
  const result = await pool.query(
    `SELECT ae.site_id, s.name AS site_name, ae.period_start, ae.period_end, SUM(er.tco2e) AS total_tco2e
     FROM emission_results er
     JOIN activity_entries ae ON ae.id = er.activity_entry_id
     LEFT JOIN sites s ON s.id = ae.site_id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
     GROUP BY ae.site_id, s.name, ae.period_start, ae.period_end
     ORDER BY ae.site_id NULLS LAST, ae.period_start`,
    [companyId],
  );

  const bySite = new Map();
  for (const row of result.rows) {
    const key = row.site_id ?? 'sans-site';
    if (!bySite.has(key)) bySite.set(key, { siteId: row.site_id, siteName: row.site_name, periods: [] });
    bySite.get(key).periods.push({
      periodStart: row.period_start,
      periodEnd: row.period_end,
      totalTco2e: Number(row.total_tco2e),
    });
  }

  for (const site of bySite.values()) {
    site.periods.forEach((period, i) => {
      if (i === 0) {
        period.variationPct = null;
        return;
      }
      const prev = site.periods[i - 1].totalTco2e;
      period.variationPct = prev > 0 ? ((period.totalTco2e - prev) / prev) * 100 : null;
    });
  }

  return [...bySite.values()];
}

function bucketKey(dateStr, frequency) {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  if (frequency === 'annuelle') return `${year}`;
  if (frequency === 'trimestrielle') return `${year}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  return `${year}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function bucketsBetween(startStr, endStr, frequency) {
  const buckets = [];
  const cursor = new Date(startStr);
  const end = new Date(endStr);
  while (cursor <= end) {
    buckets.push(bucketKey(cursor.toISOString().slice(0, 10), frequency));
    if (frequency === 'annuelle') cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
    else if (frequency === 'trimestrielle') cursor.setUTCMonth(cursor.getUTCMonth() + 3);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return [...new Set(buckets)];
}

// ============================================================
// Complétude des données (spec section 2.E) : % de (site × période
// attendue) avec au moins une saisie. Nécessite reporting_frequency —
// jamais une fréquence supposée. Toute entrée (calculée ou non) compte,
// puisqu'il s'agit de mesurer la saisie, pas le calcul.
// ============================================================
export async function getDataCompleteness(companyId, reportingFrequency) {
  if (!reportingFrequency) return { available: false, reason: 'reporting_frequency_not_set' };

  const [sitesResult, entriesResult] = await Promise.all([
    pool.query('SELECT id, name FROM sites WHERE company_id = $1', [companyId]),
    pool.query(
      `SELECT site_id, period_start, period_end FROM activity_entries
       WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId],
    ),
  ]);

  const sites = sitesResult.rows;
  const entries = entriesResult.rows;
  if (sites.length === 0 || entries.length === 0) {
    return { available: false, reason: 'no_data' };
  }

  const minStart = entries.reduce((min, e) => (e.period_start < min ? e.period_start : min), entries[0].period_start);
  const maxEnd = entries.reduce((max, e) => (e.period_end > max ? e.period_end : max), entries[0].period_end);
  const expectedBuckets = bucketsBetween(minStart, maxEnd, reportingFrequency);

  const filledBySite = new Map(sites.map((s) => [s.id, new Set()]));
  for (const entry of entries) {
    if (entry.site_id === null || !filledBySite.has(entry.site_id)) continue;
    filledBySite.get(entry.site_id).add(bucketKey(entry.period_start, reportingFrequency));
  }

  const totalCells = sites.length * expectedBuckets.length;
  let filledCells = 0;
  for (const filled of filledBySite.values()) {
    filledCells += expectedBuckets.filter((b) => filled.has(b)).length;
  }

  return {
    available: true,
    completenessPct: totalCells > 0 ? (filledCells / totalCells) * 100 : 0,
    expectedPeriods: expectedBuckets.length,
    siteCount: sites.length,
  };
}

// ============================================================
// Alarmes auto-référencées (spec section 3) — regroupées pour le bandeau
// "Points d'attention". Jamais de comparaison sectorielle ici : ces alarmes
// utilisent exclusivement les propres données de l'entreprise ou des
// paramètres déjà en base.
// ============================================================
export async function getAlerts(companyId) {
  const [thresholds, company, taxSimulation, siteMoM, quality, topContributors, baseYearGuard] = await Promise.all([
    getActiveThresholds(),
    getCompany(companyId),
    simulateCarbonTax(companyId),
    getSiteMoMSeries(companyId),
    getQualityMetrics(companyId),
    getTopContributors(companyId, 1),
    pool.query(
      `SELECT id FROM base_year_recalculations WHERE company_id = $1 AND (reason IS NULL OR TRIM(reason) = '')`,
      [companyId],
    ),
  ]);

  const alerts = [];

  if (taxSimulation.available && taxSimulation.thresholdTco2e !== null) {
    const approchePct = thresholds.get('taxe_approche_seuil_pct');
    if (taxSimulation.aboveThreshold) {
      alerts.push({
        code: 'taxe_depassement_seuil',
        severity: 'urgence',
        message: `Le total taxable (${taxSimulation.totalTco2eConsidered.toFixed(1)} tCO2e) dépasse le seuil d'assujettissement (${taxSimulation.thresholdTco2e} tCO2e).`,
      });
    } else if (approchePct !== undefined && taxSimulation.totalTco2eConsidered >= taxSimulation.thresholdTco2e * (approchePct / 100)) {
      alerts.push({
        code: 'taxe_approche_seuil',
        severity: 'urgence',
        message: `Le total taxable approche le seuil d'assujettissement (${approchePct}% atteint).`,
      });
    }
  }

  const variationMax = thresholds.get('variation_mom_max_pct');
  if (variationMax !== undefined) {
    for (const site of siteMoM) {
      for (const period of site.periods) {
        if (period.variationPct !== null && period.variationPct > variationMax) {
          alerts.push({
            code: 'variation_anormale_site',
            severity: 'urgence',
            message: `${site.siteName ?? 'Site sans nom'} : hausse de ${period.variationPct.toFixed(0)}% entre deux périodes (période du ${period.periodStart} au ${period.periodEnd}).`,
          });
        }
      }
    }
  }

  const donneesManquantesThreshold = thresholds.get('donnees_manquantes_periodes_max');
  if (donneesManquantesThreshold !== undefined && company?.reporting_frequency) {
    const intervalDays = REPORTING_INTERVAL_DAYS[company.reporting_frequency];
    const maxGapDays = intervalDays * donneesManquantesThreshold;
    const sitesResult = await pool.query('SELECT id, name FROM sites WHERE company_id = $1', [companyId]);
    const latestEntryBySite = await pool.query(
      `SELECT site_id, MAX(period_end) AS latest FROM activity_entries
       WHERE company_id = $1 AND deleted_at IS NULL GROUP BY site_id`,
      [companyId],
    );
    const latestBySite = new Map(latestEntryBySite.rows.map((r) => [r.site_id, r.latest]));
    const today = new Date();
    for (const site of sitesResult.rows) {
      const latest = latestBySite.get(site.id);
      const referenceDate = latest ? new Date(latest) : new Date(company.created_at);
      const gapDays = (today - referenceDate) / (1000 * 60 * 60 * 24);
      if (gapDays > maxGapDays) {
        alerts.push({
          code: 'donnees_manquantes',
          severity: 'urgence',
          message: `${site.name} : aucune saisie ${latest ? `depuis le ${latest}` : 'depuis la création du compte'} (fréquence attendue : ${company.reporting_frequency}).`,
        });
      }
    }
  }

  const isNationalDropMax = thresholds.get('is_national_baisse_points_max');
  if (isNationalDropMax !== undefined) {
    const series = quality.byPeriodNationalShare;
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1].nationalSharePct;
      const curr = series[i].nationalSharePct;
      if (prev !== null && curr !== null && prev - curr > isNationalDropMax) {
        alerts.push({
          code: 'chute_part_nationale',
          severity: 'urgence',
          message: `Recul de ${(prev - curr).toFixed(0)} points de la part de facteurs nationaux (période du ${series[i].periodStart} au ${series[i].periodEnd}).`,
        });
      }
    }
  }

  const concentrationMax = thresholds.get('concentration_poste_max_pct');
  if (concentrationMax !== undefined && topContributors.length > 0 && topContributors[0].pctOfTotal > concentrationMax) {
    alerts.push({
      code: 'concentration_excessive',
      severity: 'avertissement',
      message: `${topContributors[0].label} représente ${topContributors[0].pctOfTotal.toFixed(0)}% du total — concentration excessive sur un seul poste.`,
    });
  }

  if (baseYearGuard.rows.length > 0) {
    alerts.push({
      code: 'recalcul_sans_raison',
      severity: 'urgence',
      message: "Un recalcul d'année de référence existe sans raison renseignée — vérification requise.",
    });
  }

  return alerts;
}

// ============================================================
// Point d'entrée unique pour le dashboard v2 — un seul appel réseau pour
// toutes les tuiles, alarmes et sections. Le résumé Scope 1/2/3/site/période
// existant (getEmissionsSummary, /api/calculations/summary) reste la source
// pour la répartition par scope et par site déjà en place.
// ============================================================
export async function getDashboardAnalytics(companyId) {
  const company = await getCompany(companyId);
  const yearlyTotals = await getYearlyScope12Totals(companyId);
  const yearlyComparison = resolveYearlyComparison(yearlyTotals, company?.base_year ?? null);

  const [topContributors, quality, completeness, alerts, taxSimulation] = await Promise.all([
    getTopContributors(companyId, 5),
    getQualityMetrics(companyId),
    getDataCompleteness(companyId, company?.reporting_frequency ?? null),
    getAlerts(companyId),
    simulateCarbonTax(companyId),
  ]);

  const carbonIntensity =
    yearlyComparison.available && company?.annual_revenue_mad
      ? yearlyComparison.mostRecentYear.totalTco2e / (Number(company.annual_revenue_mad) / 1_000_000)
      : null;

  return {
    annualRevenueMad: company?.annual_revenue_mad === null || company?.annual_revenue_mad === undefined
      ? null
      : Number(company.annual_revenue_mad),
    yearlyComparison,
    carbonIntensity,
    topContributors,
    quality,
    completeness,
    alerts,
    taxSimulation,
  };
}
