import { pool } from '../../config/db.js';
import { getEmissionsSummary } from '../calculation/calculation.service.js';

// ============================================================
// Dispositifs de financement — contenu maintenu manuellement en V1
// (brief, section 5, module 5 : "interface d'admin simple ou seed data,
// pas de scraping automatique"). Aucun programme n'est fabriqué : la table
// reste vide jusqu'à ce que des dispositifs vérifiés soient fournis, ajoutés
// par insertion SQL directe dans financing_programs — même logique que les
// autres tables "prêtes mais vides" du projet (carbon_tax_parameters,
// exchange_rates, ratios Scope 3).
// ============================================================
export async function listActiveFinancingPrograms() {
  const result = await pool.query(
    `SELECT id, name, description, subsidy_rate, cap_amount_mad, eligibility, source_url, updated_at
     FROM financing_programs
     WHERE active = true
     ORDER BY updated_at DESC`,
  );
  return result.rows;
}

// ============================================================
// Taxe carbone nationale — simulateur (brief, module 5). Les paramètres
// (rate_per_tco2e, threshold_tco2e, taxable_scopes) restent indicatifs tant
// que la Loi de Finances 2026 n'est pas pleinement publiée/stabilisée —
// cette mise en garde doit rester visible même une fois des valeurs réelles
// configurées, pas seulement pendant l'état vide.
//
// Le périmètre de scopes soumis à la taxe (Scope 1 seul ? 1+2 ? 1+2+3 ?)
// n'est spécifié nulle part dans le brief — c'est une hypothèse, jamais une
// certitude, donc jamais figée dans le code : elle vient exclusivement de
// carbon_tax_parameters.taxable_scopes, au même titre que le taux.
// ============================================================
async function getCurrentCarbonTaxParameters() {
  const result = await pool.query(
    `SELECT id, rate_per_tco2e, threshold_tco2e, taxable_scopes, source, valid_from
     FROM carbon_tax_parameters
     WHERE valid_to IS NULL
     ORDER BY valid_from DESC LIMIT 1`,
  );
  return result.rows[0] || null;
}

export async function getCarbonTaxParametersStatus() {
  const parameters = await getCurrentCarbonTaxParameters();
  if (!parameters) {
    return { available: false };
  }
  return {
    available: true,
    ratePerTco2e: Number(parameters.rate_per_tco2e),
    thresholdTco2e: parameters.threshold_tco2e === null ? null : Number(parameters.threshold_tco2e),
    taxableScopes: parameters.taxable_scopes,
    source: parameters.source,
    validFrom: parameters.valid_from,
  };
}

function sumTaxableScopes(breakdown, taxableScopes) {
  let total = 0;
  if (taxableScopes.includes(1)) total += breakdown.scope1Tco2e;
  if (taxableScopes.includes(2)) total += breakdown.scope2LocationBasedTco2e;
  if (taxableScopes.includes(3)) total += breakdown.scope3Tco2e;
  return total;
}

// Le détail par scope est toujours renvoyé, même sans paramètres configurés
// — pour que l'UI puisse montrer "vos émissions sont déjà calculées" sans
// présupposer QUEL périmètre sera retenu (ça, seule la LF2026 le dira). Le
// total taxable n'est calculé qu'une fois taxable_scopes réellement défini.
export async function simulateCarbonTax(companyId) {
  const summary = await getEmissionsSummary(companyId);
  const breakdown = {
    scope1Tco2e: summary.scope1Tco2e,
    scope2LocationBasedTco2e: summary.scope2LocationBasedTco2e,
    scope3Tco2e: summary.scope3Tco2e,
  };

  const parameters = await getCurrentCarbonTaxParameters();
  if (!parameters) {
    return { available: false, breakdown };
  }

  const taxableScopes = parameters.taxable_scopes;
  const totalTco2eConsidered = sumTaxableScopes(breakdown, taxableScopes);
  const threshold = parameters.threshold_tco2e === null ? null : Number(parameters.threshold_tco2e);
  const aboveThreshold = threshold === null ? true : totalTco2eConsidered >= threshold;
  const estimatedTaxMad = aboveThreshold ? totalTco2eConsidered * Number(parameters.rate_per_tco2e) : 0;

  return {
    available: true,
    breakdown,
    taxableScopes,
    totalTco2eConsidered,
    ratePerTco2e: Number(parameters.rate_per_tco2e),
    thresholdTco2e: threshold,
    aboveThreshold,
    estimatedTaxMad,
    source: parameters.source,
    validFrom: parameters.valid_from,
  };
}
