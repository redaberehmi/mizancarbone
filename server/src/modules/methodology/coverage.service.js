import { createHash } from 'node:crypto';
import { pool } from '../../config/db.js';
import { SCOPE3_CATEGORY_LABELS } from '../activity-entries/constants.js';

// ============================================================
// Diagnostic des sources d'émission et couverture du bilan.
// Un poste non calculable reste visible (manquant / non pris en charge),
// jamais assimilé à zéro.
// ============================================================

export const EMISSION_SOURCES = [
  { code: 'S1_combustion_fixe', scope: 1, label: 'Combustion — sources fixes (chaudières, fours, groupes électrogènes)', supported: true, categories: ['combustion_fixe'] },
  { code: 'S1_combustion_mobile', scope: 1, label: 'Combustion — véhicules et engins de l’entreprise', supported: true, categories: ['combustion_mobile'] },
  { code: 'S1_procedes', scope: 1, label: 'Émissions de procédés (décarbonatation, chimie, traitement des eaux…)', supported: true, categories: ['procede'] },
  { code: 'S1_fugitives', scope: 1, label: 'Émissions fugitives (fuites de fluides frigorigènes)', supported: true, categories: ['fugitive'] },
  { code: 'S2_electricite', scope: 2, label: 'Électricité achetée', supported: true, categories: ['electricite_location_based'] },
  { code: 'S2_chaleur_vapeur_froid', scope: 2, label: 'Vapeur, chaleur ou froid achetés', supported: false, categories: [] },
  ...Object.entries(SCOPE3_CATEGORY_LABELS).map(([cat, label]) => ({
    code: `S3_C${cat}`,
    scope: 3,
    scope3Category: Number(cat),
    label: `Cat. ${cat} — ${label}`,
    supported: [1, 2, 3, 4, 5, 9].includes(Number(cat)),
    supportNote:
      Number(cat) === 3
        ? "Pris en charge : pertes en ligne du réseau électrique. Non pris en charge : amont des combustibles (les facteurs FM6E disponibles ne sont pas décomposés)."
        : null,
  })),
];

// Indications de pertinence par secteur — signalées comme des
// SUGGESTIONS de MizanCarbone, à confirmer par l'entreprise.
const SECTOR_HINTS = {
  ciment: { S1_procedes: 'Décarbonatation du calcaire lors de la production de clinker.' },
  fer_et_acier: { S1_procedes: 'Émissions de procédé (réduction, électrodes, décarbonatation).' },
  metallurgie: { S1_procedes: 'Selon les procédés (fonderie, traitement thermique) : à évaluer.' },
  aluminium: { S1_procedes: 'Électrolyse (anodes) et émissions de PFC selon le procédé.' },
  engrais: { S1_procedes: "Production d'ammoniac / acide nitrique (N2O) : émissions de procédé." },
  agroalimentaire: { S1_fugitives: 'Installations de froid : fuites de fluides frigorigènes.' },
  electricite: { S1_combustion_fixe: 'Production d’électricité thermique : combustion des centrales (Scope 1).' },
  hydrogene: { S1_procedes: 'Selon la voie de production (vaporeformage, électrolyse) : à évaluer.' },
};

export async function getSourceRelevance(companyId, client = pool) {
  const result = await client.query(
    'SELECT source_code, status, justification, updated_at FROM emission_source_relevance WHERE company_id = $1',
    [companyId],
  );
  return result.rows.map((r) => ({ sourceCode: r.source_code, status: r.status, justification: r.justification, updatedAt: r.updated_at }));
}

export async function getCoverageDiagnostic(companyId) {
  const [company, relevance, entries] = await Promise.all([
    pool.query('SELECT sector, activity_role FROM companies WHERE id = $1', [companyId]),
    getSourceRelevance(companyId),
    pool.query(
      `SELECT COALESCE(ef.category, cat.category) AS category,
              COALESCE(ae.scope3_category, ef.scope3_category, cat.scope3_category) AS scope3_category,
              COALESCE(ef.scope, cat.scope) AS scope,
              COUNT(*)::int AS entry_count,
              COUNT(er.id)::int AS calculated_count,
              COALESCE(SUM(er.tco2e), 0) AS tco2e
       FROM activity_entries ae
       LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
       LEFT JOIN emission_factors ef ON ef.id = er.emission_factor_id
       LEFT JOIN LATERAL (
         SELECT category, scope3_category, scope FROM emission_factors ef2 WHERE ef2.code = ae.factor_code ORDER BY valid_from DESC LIMIT 1
       ) cat ON true
       WHERE ae.company_id = $1 AND ae.deleted_at IS NULL AND ae.material_label IS NULL
       GROUP BY 1, 2, 3`,
      [companyId],
    ),
  ]);
  const sector = company.rows[0]?.sector;
  const hints = SECTOR_HINTS[sector] ?? {};

  const sources = EMISSION_SOURCES.map((src) => {
    const rows = entries.rows.filter((r) =>
      src.scope === 3 ? r.scope === 3 && Number(r.scope3_category) === src.scope3Category : src.categories.includes(r.category),
    );
    const entryCount = rows.reduce((s, r) => s + r.entry_count, 0);
    const calculatedCount = rows.reduce((s, r) => s + r.calculated_count, 0);
    const tco2e = rows.reduce((s, r) => s + Number(r.tco2e), 0);
    const rel = relevance.find((r) => r.sourceCode === src.code);
    let dataState;
    if (entryCount === 0) dataState = 'manquant';
    else if (calculatedCount === 0) dataState = 'non_calcule';
    else if (calculatedCount < entryCount) dataState = 'partiel';
    else dataState = 'calcule';
    return {
      ...src,
      relevance: rel?.status ?? 'a_evaluer',
      justification: rel?.justification ?? null,
      sectorHint: hints[src.code] ?? null,
      entryCount,
      calculatedCount,
      tco2e: calculatedCount > 0 ? tco2e : null,
      dataState,
    };
  });

  const relevant = sources.filter((s) => s.relevance === 'pertinente');
  const toAssess = sources.filter((s) => s.relevance === 'a_evaluer');
  return {
    sector,
    activityRole: company.rows[0]?.activity_role,
    sources,
    summary: {
      relevantCount: relevant.length,
      relevantCalculated: relevant.filter((s) => s.dataState === 'calcule').length,
      relevantMissing: relevant.filter((s) => s.dataState === 'manquant' || s.dataState === 'non_calcule').map((s) => s.label),
      relevantUnsupported: relevant.filter((s) => !s.supported).map((s) => s.label),
      toAssessCount: toAssess.length,
    },
    note:
      "La couverture est déclarative : MizanCarbone ne peut pas savoir qu'un poste existe tant que l'entreprise ne l'a pas qualifié. Un poste « à évaluer » ou « pertinent » sans donnée reste affiché comme manquant ; il n'est jamais compté comme nul.",
  };
}

// Empreinte de l'inventaire : change dès qu'une donnée, un facteur utilisé,
// un résultat, un instrument électrique OU le périmètre organisationnel
// (éléments inclus/exclus, description, approche, rôle) change. Sert à
// savoir si un avis externe porte sur la version actuelle.
export async function computeInventoryFingerprint(companyId, client = pool) {
  const [entries, contracts, boundaryItems, company, baseYearVersions] = await Promise.all([
    client.query(
      `SELECT ae.id, ae.factor_code, ae.quantity, ae.period_start, ae.period_end, ae.site_id, ae.scope3_category,
              er.emission_factor_id, er.tco2e
       FROM activity_entries ae
       LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
       WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
       ORDER BY ae.id`,
      [companyId],
    ),
    client.query(
      'SELECT id, site_id, instrument_type, period_start, period_end, volume_kwh, factor_kgco2e_per_kwh FROM electricity_contracts WHERE company_id = $1 ORDER BY id',
      [companyId],
    ),
    client.query(
      `SELECT id, item_type, name, site_id, included, has_operational_control, ownership_pct, justification
       FROM organizational_boundary_items WHERE company_id = $1 ORDER BY id`,
      [companyId],
    ),
    client.query('SELECT consolidation_approach, boundary_description, activity_role, base_year FROM companies WHERE id = $1', [companyId]),
    // Un recalcul validé de l'année de référence change l'inventaire.
    client.query(
      `SELECT id, base_year, version_number, total_scope12_tco2e, scope3_tco2e
       FROM base_year_inventory_versions WHERE company_id = $1 ORDER BY id`,
      [companyId],
    ),
  ]);
  const payload = JSON.stringify({
    entries: entries.rows,
    contracts: contracts.rows,
    boundary: { items: boundaryItems.rows, company: company.rows[0] ?? null },
    baseYearVersions: baseYearVersions.rows,
  });
  return createHash('sha256').update(payload).digest('hex');
}
