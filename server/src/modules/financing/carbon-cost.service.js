import { pool } from '../../config/db.js';
import { computeMarketBased } from '../electricity/market-based.service.js';

// ============================================================
// Simulation de coût carbone (interne). N'est PAS un calcul de taxe : le
// texte officiel marocain fixant un taux, une assiette ou un seuil n'a pas
// été confirmé (recherche du 2026-11-18 : la loi de finances n° 50-25 pour
// 2026 a été promulguée le 10/12/2025, BO 7465-bis, mais aucune disposition
// de taxe carbone avec taux et assiette n'a pu être vérifiée dans le texte).
// Le prix, la devise, le périmètre et l'année sont des HYPOTHÈSES saisies
// par l'utilisateur, toujours restituées avec le résultat.
// ============================================================

export const CARBON_COST_DISCLAIMER =
  "Simulation interne de coût carbone, fondée sur les hypothèses saisies (prix, devise, périmètre, année). Elle ne constitue ni un montant de taxe dû, ni une obligation fiscale chiffrée : aucun régime de taxe carbone marocain (taux, assiette, seuil) n'a été confirmé dans un texte officiel à ce jour. Elle est distincte du mécanisme européen CBAM, qui s'applique aux importateurs de l'UE.";

export const REGULATORY_STATUS = {
  checkedOn: '2026-11-18',
  status: 'non_confirme',
  detail:
    "Loi de finances n° 50-25 pour l'année 2026 promulguée par le dahir n° 1-25-67 du 10 décembre 2025 (Bulletin officiel n° 7465 bis). Aucun article fixant un taux, une assiette ou un seuil de taxe carbone n'a pu être vérifié dans le texte officiel ; des sources secondaires divergent.",
};

function iso(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

export async function simulateCarbonCost(companyId, { pricePerTco2e, currency, scopes, year, scope2Method }) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  // Toutes les entrées de l'année (calculées ou non), classées par scope via
  // le catalogue : distingue « aucune donnée », « saisie non calculée » et
  // « calculé ». L'ancien ratio sectoriel global (méthode isolée) est exclu.
  const r = await pool.query(
    `SELECT COALESCE(ef.scope, cat.scope) AS scope, COALESCE(ef.category, cat.category) AS category,
            COUNT(*)::int AS entry_count, COUNT(er.id)::int AS calculated_count, COALESCE(SUM(er.tco2e), 0) AS total
     FROM activity_entries ae
     LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
     LEFT JOIN emission_factors ef ON ef.id = er.emission_factor_id
     LEFT JOIN LATERAL (SELECT scope, category FROM emission_factors ef2 WHERE ef2.code = ae.factor_code ORDER BY valid_from DESC LIMIT 1) cat ON true
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL AND ae.material_label IS NULL
       AND ae.period_start >= $2 AND ae.period_end <= $3
     GROUP BY 1, 2`,
    [companyId, yearStart, yearEnd],
  );
  const stat = { 1: { entries: 0, calculated: 0, total: 0 }, 2: { entries: 0, calculated: 0, total: 0 }, 3: { entries: 0, calculated: 0, total: 0 } };
  for (const row of r.rows) {
    if (row.category === 'scope3_ratio') continue;
    if (row.scope === 2 && row.category !== 'electricite_location_based') continue;
    const s = stat[row.scope];
    if (!s) continue;
    s.entries += row.entry_count;
    s.calculated += row.calculated_count;
    s.total += Number(row.total);
  }
  if (scope2Method === 'market') {
    const mb = await computeMarketBased(companyId);
    stat[2].total = mb.lines
      .filter((l) => l.marketTco2e !== null && iso(l.periodStart) >= yearStart && iso(l.periodEnd) <= yearEnd)
      .reduce((sum, l) => sum + l.marketTco2e, 0);
  }

  const missingScopes = scopes.filter((sc) => stat[sc].entries === 0);
  const uncalculatedScopes = scopes.filter((sc) => stat[sc].entries > 0 && stat[sc].calculated < stat[sc].entries);
  const usableScopes = scopes.filter((sc) => stat[sc].calculated > 0);
  const emissionsByScope = Object.fromEntries(scopes.map((sc) => [sc, stat[sc].calculated > 0 ? stat[sc].total : null]));

  let status;
  if (usableScopes.length === 0) status = 'non_calculable';
  else if (missingScopes.length > 0 || uncalculatedScopes.length > 0 || scopes.includes(3)) status = 'partiel';
  else status = 'calcule';

  const consideredTco2e = usableScopes.length === 0 ? null : usableScopes.reduce((sum, sc) => sum + stat[sc].total, 0);
  const reasons = [];
  if (missingScopes.length > 0) reasons.push(`aucune donnée pour le Scope ${missingScopes.join(' et ')} en ${year}`);
  if (uncalculatedScopes.length > 0) reasons.push(`données saisies non calculées pour le Scope ${uncalculatedScopes.join(' et ')}`);
  if (scopes.includes(3) && stat[3].calculated > 0) reasons.push('Scope 3 limité aux catégories renseignées');

  return {
    assumptions: { pricePerTco2e, currency, scopes, year, scope2Method: scopes.includes(2) ? scope2Method : null },
    status,
    statusDetail: status === 'non_calculable'
      ? `Simulation non calculable : ${reasons.join(' ; ')}. Une absence de données n'est jamais un zéro.`
      : reasons.length > 0 ? `Résultat partiel : ${reasons.join(' ; ')}.` : null,
    missingScopes,
    uncalculatedScopes,
    emissionsByScope,
    consideredTco2e,
    simulatedCost: consideredTco2e === null ? null : consideredTco2e * pricePerTco2e,
    currency,
    note: 'Seules les données dont la période est entièrement comprise dans l’année choisie sont retenues.',
    disclaimer: CARBON_COST_DISCLAIMER,
    regulatoryStatus: REGULATORY_STATUS,
  };
}
