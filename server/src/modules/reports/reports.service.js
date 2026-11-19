import { pool } from '../../config/db.js';
import { getEmissionsSummary } from '../calculation/calculation.service.js';
import { getDataCompleteness } from './dashboard-analytics.service.js';
import { renderBrandedHtml, htmlToPdfBuffer } from './pdf-template.js';
import { csvEscape } from './csv-escape.js';
import { computeInventoryFingerprint } from '../methodology/coverage.service.js';

// Formulation de référence de l'outil (révision méthodologique 2026-11).
export const TOOL_STATEMENT =
  "Outil de collecte, de calcul et de préparation des inventaires de gaz à effet de serre, avec traçabilité des données et des hypothèses.";

export const BOUNDARY_LABELS = {
  combustion: 'Combustion seule',
  combustion_amont: 'Combustion + amont (non décomposé)',
  amont: 'Amont',
  procede: 'Procédé',
  fugitive: 'Fuite (PRG)',
  mix_production: 'Mix de production, hors pertes réseau',
  mix_inconnu: 'Couverture non documentée',
  pertes_reseau: 'Pertes en ligne',
  cycle_de_vie: 'Cycle de vie',
  berceau_porte: 'Berceau à la porte',
  transport_amont_combustion: 'Transport (amont + combustion)',
  fin_de_vie: 'Fin de vie',
  monetaire: 'Ratio monétaire',
  non_precise: 'Non précisé par la source',
};
export const METHOD_STATUS_LABELS = {
  valide_source_primaire: 'Source primaire validée',
  a_confirmer: 'À confirmer',
  source_secondaire: 'Source secondaire',
  non_utilisable: 'Non utilisable',
  retire: 'Retiré',
};
export const RIGHTS_LABELS = { non_applicable: 'Sans objet', a_confirmer: 'Droits de réutilisation à confirmer', confirme: 'Droits confirmés', refuse: 'Droits refusés' };
const RELEVANCE_LABELS = { pertinente: 'Pertinente', non_pertinente: 'Non pertinente (justifiée)', a_evaluer: 'À évaluer' };

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

export function describeFactorProvenance(f) {
  if (!f.source_file) return '';
  return `${f.source_file}${f.source_sheet ? ` — ${f.source_sheet}` : ''}${f.source_cell ? ` ! ${f.source_cell}` : ''}`;
}
import { STATUS_LABELS, formatStatusLabel, formatTco2e, determineLineStatus } from './report-formatting.js';
import { sectorLabel, createWorkbook, addInfoSheet, addTableSheet, workbookToBuffer, TCO2E_FORMAT } from './xlsx-helpers.js';

async function getCompany(companyId) {
  const result = await pool.query(
    'SELECT id, name, sector, base_year, reporting_frequency FROM companies WHERE id = $1',
    [companyId],
  );
  return result.rows[0] || null;
}

async function getSiteCount(companyId) {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM sites WHERE company_id = $1', [companyId]);
  return result.rows[0].count;
}

// Période réellement couverte par les données saisies — jamais l'année de
// référence (base_year), qui n'est qu'une convention GHG Protocol pour les
// comparaisons dans le temps, pas la fenêtre réelle des données du rapport.
async function getReportingPeriodRange(companyId) {
  const result = await pool.query(
    `SELECT MIN(period_start) AS min_start, MAX(period_end) AS max_end, COUNT(*)::int AS entry_count
     FROM activity_entries WHERE company_id = $1 AND deleted_at IS NULL`,
    [companyId],
  );
  const row = result.rows[0];
  return { minStart: row.min_start, maxEnd: row.max_end, entryCount: row.entry_count };
}

function completenessLabel(completeness) {
  if (completeness.available) return `${completeness.completenessPct.toFixed(0)}%`;
  if (completeness.reason === 'reporting_frequency_not_set') {
    return 'Non calculable (fréquence de reporting non renseignée dans le profil entreprise)';
  }
  return 'Non calculable (aucune donnée saisie)';
}

// Données brutes complètes — toutes natures confondues (énergie, matière
// première, estimations Scope 3), contrairement à l'export CSV du Module 4
// qui est structuré par produit pour un usage CBAM spécifique. C'est le
// dump complet des données saisies et calculées, pour analyse externe.
async function getAllEntriesWithResults(companyId) {
  const result = await pool.query(
    `SELECT ae.id, ae.site_id, s.name AS site_name, ae.period_start, ae.period_end,
            ae.factor_code, ae.quantity, ae.material_label, ae.supplier, ae.product_allocation,
            ae.source_document, ae.created_at,
            ef.label AS factor_label, ef.unit AS factor_unit, ef.source AS factor_source, ef.is_national,
            er.scope, er.tco2e, er.verification_status
     FROM activity_entries ae
     LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
     LEFT JOIN emission_factors ef ON ef.id = er.emission_factor_id
     LEFT JOIN sites s ON s.id = ae.site_id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
     ORDER BY ae.period_start DESC, ae.id DESC`,
    [companyId],
  );
  return result.rows;
}

function classifyEntry(row) {
  if (row.factor_code?.startsWith('scope3_ratio_')) return 'scope3_estimation';
  if (row.material_label !== null) return 'matiere_premiere';
  if (row.scope === 3) return 'scope3_estimation';
  return 'energie';
}

export async function buildRawDataCsvExport(companyId) {
  const rows = await getAllEntriesWithResults(companyId);
  const headers = [
    'id', 'nature', 'site', 'periode_debut', 'periode_fin', 'description', 'quantite', 'unite',
    'fournisseur', 'produit_alloue', 'scope', 'tco2e', 'source_facteur', 'facteur_national',
    'statut_controle_interne', 'document_source', 'cree_le',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((r) => {
      const kind = classifyEntry(r);
      const description = kind === 'matiere_premiere' ? r.material_label : (r.factor_label ?? r.factor_code);
      return [
        csvEscape(r.id),
        csvEscape(kind),
        csvEscape(r.site_name ?? ''),
        csvEscape(r.period_start),
        csvEscape(r.period_end),
        csvEscape(description),
        csvEscape(r.quantity),
        csvEscape(kind === 'matiere_premiere' ? '' : (r.factor_unit ?? '')),
        csvEscape(r.supplier ?? ''),
        csvEscape(r.product_allocation ?? ''),
        csvEscape(r.scope ?? ''),
        csvEscape(r.tco2e === null ? '' : r.tco2e),
        csvEscape(r.factor_source ?? ''),
        csvEscape(r.is_national === null ? '' : r.is_national ? 'oui' : 'non'),
        csvEscape(r.verification_status ?? ''),
        csvEscape(r.source_document ?? ''),
        csvEscape(r.created_at?.toISOString?.() ?? r.created_at ?? ''),
      ].join(',');
    }),
  ];

  return {
    filename: `donnees-brutes-mizancarbone-${new Date().toISOString().slice(0, 10)}.csv`,
    content: lines.join('\n'),
  };
}

// Liste des facteurs réellement utilisés par cette entreprise (jamais tout
// le catalogue emission_factors — seulement ce qui a servi à un calcul),
// chacun avec sa source affichée : jamais un facteur sans source dans
// l'annexe méthodologique (brief, module 6).
export async function getFactorsUsedByCompany(companyId) {
  const result = await pool.query(
    `SELECT DISTINCT ef.id, ef.code, ef.label, ef.scope, ef.category, ef.unit, ef.value_kgco2e, ef.source, ef.is_national,
            ef.valid_from, ef.valid_to, ef.represented_year, ef.boundary, ef.source_file, ef.source_sheet, ef.source_cell,
            ef.uncertainty_pct, ef.usage_restrictions, ef.methodological_status, ef.rights_status, ef.gwp_reference
     FROM emission_results er
     JOIN activity_entries ae ON ae.id = er.activity_entry_id
     JOIN emission_factors ef ON ef.id = er.emission_factor_id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
     ORDER BY ef.scope, ef.label`,
    [companyId],
  );
  return result.rows;
}

function escapeCell(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Rend le contenu d'une cellule tCO2e en respectant le statut de la donnée
// (jamais une confusion 0/non calculé) : le nombre n'est affiché que pour
// les statuts qui en portent réellement un (estime/zero_reel/reel) — pour
// manquant/non_calcule, le libellé de statut remplace le nombre, il ne
// s'ajoute pas à côté d'un "0" trompeur.
function scopeValueCell(value, statusResult) {
  if (statusResult.status === 'manquant' || statusResult.status === 'non_calcule') {
    return STATUS_LABELS[statusResult.status];
  }
  return statusResult.hasUncalculatedEntries
    ? `${formatTco2e(value)} (partiel)`
    : formatTco2e(value);
}

function statusTag(statusResult) {
  const label = formatStatusLabel(statusResult.status, {
    needsVerification: statusResult.needsVerification,
    incomplete: statusResult.hasUncalculatedEntries && statusResult.status !== 'non_calcule',
  });
  return `<span class="status-tag" data-status="${statusResult.status}">${escapeCell(label)}</span>`;
}

// Séparée de buildDashboardPdfExport pour être testable directement : un
// PDF est binaire, on ne peut pas facilement y chercher du texte, alors que
// le HTML source (ce qui est réellement injecté dans le document) l'est.
export async function buildReportHtml(companyId) {
  const [company, summary, factorsUsed, siteCount, periodRange, assuranceRows, fingerprint] = await Promise.all([
    getCompany(companyId),
    getEmissionsSummary(companyId),
    getFactorsUsedByCompany(companyId),
    getSiteCount(companyId),
    getReportingPeriodRange(companyId),
    pool.query('SELECT provider_name, statement_date, assurance_level, inventory_fingerprint FROM external_assurance_statements WHERE company_id = $1 ORDER BY statement_date DESC', [companyId]),
    computeInventoryFingerprint(companyId),
  ]);
  const assurance = assuranceRows.rows;

  const completeness = await getDataCompleteness(companyId, company?.reporting_frequency ?? null);

  const scopeStatuses = [
    summary.scope1Status,
    summary.scope2LocationBasedStatus,
    summary.scope3Status,
  ];
  // Total Scope 1 + Scope 2 (location-based) + Scope 3 — jamais le
  // market-based, qui est un double-reporting optionnel, pas le total de
  // référence. "Partiel" dès qu'un des trois postes composant ce total n'est
  // pas intégralement calculé (manquant, non_calcule, OU un mélange
  // calculé/non calculé au sein du même poste — hasUncalculatedEntries,
  // trouvé en vérification visuelle réelle : sans ce troisième cas, un scope
  // avec une entrée calculée ET une entrée non calculée affichait "reel" et
  // laissait croire à un total complet qui excluait pourtant une saisie).
  const totalIsPartial = scopeStatuses.some(
    (s) => s.status === 'manquant' || s.status === 'non_calcule' || s.hasUncalculatedEntries,
  );
  const totalTco2e = summary.scope1Tco2e + summary.scope2LocationBasedTco2e + summary.scope3Tco2e;

  const periodLabel = periodRange.entryCount > 0
    ? `du ${periodRange.minStart} au ${periodRange.maxEnd}`
    : 'Aucune donnée saisie à ce jour';

  const bySiteRows = summary.bySite
    .map((s) => `<tr><td>${escapeCell(s.siteName ?? 'Sans site')}</td><td class="mono">${formatTco2e(s.totalTco2e)}</td></tr>`)
    .join('');

  const byPeriodRows = summary.byPeriod
    .map((p) => `<tr><td class="mono">${p.periodStart} → ${p.periodEnd}</td><td class="mono">${formatTco2e(p.totalTco2e)}</td></tr>`)
    .join('');

  const factorsRows = factorsUsed
    .map((f) => `
      <tr>
        <td>Scope ${f.scope}</td>
        <td>${escapeCell(f.label)}<br><span style="font-size:9px;color:#5B6670;">Périmètre : ${escapeCell(BOUNDARY_LABELS[f.boundary] ?? 'Non renseigné')}${f.gwp_reference ? ` · PRG : ${escapeCell(f.gwp_reference)}` : ''}</span></td>
        <td class="mono">${formatTco2e(f.value_kgco2e, { maximumFractionDigits: 6 })} kgCO2e/${escapeCell(f.unit)}${f.uncertainty_pct !== null ? `<br>± ${escapeCell(f.uncertainty_pct)} %` : ''}</td>
        <td>Année représentée : ${escapeCell(f.represented_year ?? 'non renseignée')}<br>Utilisation retenue : ${escapeCell(isoDate(f.valid_from))} → ${escapeCell(isoDate(f.valid_to) ?? 'en cours')}</td>
        <td>${escapeCell(f.source)}${describeFactorProvenance(f) ? `<br><span style="font-size:9px;">${escapeCell(describeFactorProvenance(f))}</span>` : ''}
          <br><span style="font-size:9px;">${escapeCell(METHOD_STATUS_LABELS[f.methodological_status] ?? f.methodological_status)} · ${escapeCell(RIGHTS_LABELS[f.rights_status] ?? f.rights_status)}</span>
          ${f.usage_restrictions ? `<br><span style="font-size:9px;color:#5B6670;">${escapeCell(f.usage_restrictions)}</span>` : ''}</td>
      </tr>`)
    .join('');

  const scope1Rows = summary.scope1Breakdown
    .map((b) => `<tr><td>${escapeCell(b.label)}</td><td class="mono">${scopeValueCell(b.tco2e ?? 0, b)}</td><td>${statusTag(b)}</td></tr>`)
    .join('');

  const scope3Rows = summary.scope3Breakdown
    .filter((c) => c.entryCount > 0 || c.relevance !== 'non_pertinente')
    .map((c) => `<tr><td>Cat. ${c.category} — ${escapeCell(c.label)}</td><td>${escapeCell(RELEVANCE_LABELS[c.relevance])}</td><td class="mono">${scopeValueCell(c.tco2e ?? 0, c)}</td><td>${statusTag(c)}</td></tr>`)
    .join('');

  const mb = summary.scope2MarketBased;
  const assuranceHtml = assurance.length === 0
    ? '<p>Aucun avis de vérification externe enregistré.</p>'
    : `<ul>${assurance.map((a) => `<li>${escapeCell(a.provider_name)}, ${escapeCell(isoDate(a.statement_date))}, niveau d'assurance : ${escapeCell(a.assurance_level)} — ${a.inventory_fingerprint === fingerprint ? 'porte sur la version actuelle de l’inventaire' : '<b>porte sur une version antérieure de l’inventaire : non applicable aux chiffres ci-dessus</b>'}.</li>`).join('')}</ul>`;

  const summaryHtml = `
    <h2>Résumé exécutif</h2>
    <div class="kpi-grid">
      <div class="kpi-tile"><div class="kpi-label">Entreprise</div><div class="kpi-value">${escapeCell(company?.name ?? '—')}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Secteur</div><div class="kpi-value">${escapeCell(sectorLabel(company?.sector) ?? '—')}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Période couverte</div><div class="kpi-value mono">${escapeCell(periodLabel)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Année de référence</div><div class="kpi-value mono">${company?.base_year ?? 'Non renseignée'}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Nombre de sites</div><div class="kpi-value mono">${siteCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Scope 1</div><div class="kpi-value mono">${scopeValueCell(summary.scope1Tco2e, summary.scope1Status)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Scope 2 (location-based)</div><div class="kpi-value mono">${scopeValueCell(summary.scope2LocationBasedTco2e, summary.scope2LocationBasedStatus)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Scope 3 (estimé)</div><div class="kpi-value mono">${scopeValueCell(summary.scope3Tco2e, summary.scope3Status)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Total tCO2e (partiel)</div><div class="kpi-value mono">${totalIsPartial ? 'Partiel — voir statuts ci-dessous' : `${formatTco2e(totalTco2e)} — Scope 3 : ${summary.scope3Coverage.categoriesWithData}/15 catégories`}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Taux de données disponibles</div><div class="kpi-value mono">${escapeCell(completenessLabel(completeness))}</div></div>
    </div>
    <p class="mono" style="font-size:10.5px;color:#5B6670;">
      ${escapeCell(TOOL_STATEMENT)} Périmètre organisationnel : contrôle opérationnel (100 % des émissions des
      opérations que l'entreprise contrôle opérationnellement, indépendamment du pourcentage de détention).
    </p>
    <div class="page-break"></div>
  `;

  const bodyHtml = `
    ${summaryHtml}
    <p>
      Année de référence (base year) : <span class="mono">${company?.base_year ?? 'non renseignée'}</span>.
      Ce rapport est un document de préparation interne. MizanCarbone ne réalise aucune vérification : seule une
      vérification indépendante, par un organisme tiers, peut attester de l'inventaire.
    </p>

    <h2>Émissions par scope</h2>
    <table>
      <thead><tr><th>Poste</th><th>tCO2e</th><th>Statut</th></tr></thead>
      <tbody>
        <tr><td>Scope 1</td><td class="mono">${scopeValueCell(summary.scope1Tco2e, summary.scope1Status)}</td><td>${statusTag(summary.scope1Status)}</td></tr>
        <tr><td>Scope 2 — location-based</td><td class="mono">${scopeValueCell(summary.scope2LocationBasedTco2e, summary.scope2LocationBasedStatus)}</td><td>${statusTag(summary.scope2LocationBasedStatus)}</td></tr>
        <tr><td>Scope 2 — market-based</td><td class="mono">${scopeValueCell(summary.scope2MarketBasedTco2e, summary.scope2MarketBasedStatus)}</td><td>${statusTag(summary.scope2MarketBasedStatus)}</td></tr>
        <tr><td>Scope 3 — catégories renseignées (partiel)</td><td class="mono">${scopeValueCell(summary.scope3Tco2e, summary.scope3Status)}</td><td>${statusTag(summary.scope3Status)}</td></tr>
      </tbody>
    </table>
    <div class="callout">Les deux résultats Scope 2 (location-based et market-based) sont présentés séparément et ne s'additionnent jamais. Le total de référence utilise le location-based.</div>

    <h2>Scope 1 — détail par poste</h2>
    <table>
      <thead><tr><th>Poste</th><th>tCO2e</th><th>Statut</th></tr></thead>
      <tbody>${scope1Rows}</tbody>
    </table>

    <h2>Scope 2 — market-based</h2>
    <p>Consommation d'électricité achetée : <span class="mono">${formatTco2e(mb.consumptionKwh, { maximumFractionDigits: 0 })} kWh</span> ·
      couverte par des instruments admissibles : <span class="mono">${formatTco2e(mb.admissibleKwh, { maximumFractionDigits: 0 })} kWh</span> ·
      calculée avec le facteur de repli : <span class="mono">${formatTco2e(mb.fallbackKwh, { maximumFractionDigits: 0 })} kWh</span>.
      ${mb.selfConsumptionKwh > 0 ? `Autoconsommation déclarée (hors Scope 2) : <span class="mono">${formatTco2e(mb.selfConsumptionKwh, { maximumFractionDigits: 0 })} kWh</span>. ` : ''}
      ${mb.soldKwh > 0 ? `Électricité vendue (non déduite des émissions) : <span class="mono">${formatTco2e(mb.soldKwh, { maximumFractionDigits: 0 })} kWh</span>.` : ''}</p>
    <div class="callout">${escapeCell(mb.fallbackNote)}</div>

    <h2>Scope 3 — catégories et couverture</h2>
    <p>Estimation partielle : ${summary.scope3Coverage.categoriesWithData} catégorie(s) sur 15 renseignée(s) ;
      ${summary.scope3Coverage.categoriesRelevant} jugée(s) pertinente(s) par l'entreprise ; ${summary.scope3Coverage.categoriesNotRelevant} exclue(s) avec justification.
      Ce n'est jamais un « Scope 3 complet ». L'incertitude est celle indiquée par chaque facteur (voir annexe), pas une incertitude statistique calculée.</p>
    <table>
      <thead><tr><th>Catégorie</th><th>Pertinence</th><th>tCO2e</th><th>Statut</th></tr></thead>
      <tbody>${scope3Rows}</tbody>
    </table>

    <h2>Répartition par site</h2>
    <table>
      <thead><tr><th>Site</th><th>tCO2e</th></tr></thead>
      <tbody>${bySiteRows || '<tr><td colspan="2">Aucune donnée.</td></tr>'}</tbody>
    </table>

    <h2>Évolution par période</h2>
    <table>
      <thead><tr><th>Période</th><th>tCO2e</th></tr></thead>
      <tbody>${byPeriodRows || '<tr><td colspan="2">Aucune donnée.</td></tr>'}</tbody>
    </table>

    <h2>Annexe — facteurs d'émission utilisés</h2>
    <p>
      Pour chaque facteur : valeur, périmètre couvert, année représentée (distincte de la période pour laquelle
      son utilisation a été retenue), source avec fichier, feuille et cellule, statut méthodologique et statut des
      droits de réutilisation. Un facteur ancien utilisé faute de donnée plus récente est signalé dans ses restrictions.
    </p>
    <table>
      <thead><tr><th>Scope</th><th>Facteur</th><th>Valeur</th><th>Années</th><th>Source et statuts</th></tr></thead>
      <tbody>${factorsRows || '<tr><td colspan="5">Aucun facteur utilisé pour le moment.</td></tr>'}</tbody>
    </table>

    <h2>Vérification externe</h2>
    ${assuranceHtml}

    <h2>Méthodologie et limites</h2>
    <p>
      <b>Périmètre :</b> contrôle opérationnel ; les approches « part du capital » et « contrôle financier » ne sont
      pas prises en charge. <b>Méthode :</b> chaque donnée est calculée ligne par ligne (quantité × facteur
      d'émission versionné, sélectionné selon la période exacte de la donnée). Un facteur « combustion + amont »
      n'est jamais utilisé pour le Scope 1. Les achats évalués par ratio monétaire (kgCO2e/kMAD) sont des
      estimations : montant en MAD / 1000 × facteur, sans conversion de devise. <b>Données manquantes :</b> un poste
      « Manquant » n'a reçu aucune saisie ; « Non calculé » signale une saisie sans facteur utilisable pour sa
      période. Les postes non pris en charge par l'outil restent affichés comme tels. <b>Limites :</b> ce rapport
      ne couvre que les données saisies ; l'exhaustivité du périmètre dépend du diagnostic réalisé par l'entreprise.
      <b>Statut :</b> document de préparation interne, sans vérification par un tiers.
    </p>
  `;

  return renderBrandedHtml({
    title: 'Rapport carbone',
    companyName: company?.name,
    generatedAtLabel: new Date().toLocaleDateString('fr-FR'),
    bodyHtml,
  });
}

export async function buildDashboardPdfExport(companyId) {
  const html = await buildReportHtml(companyId);
  const buffer = await htmlToPdfBuffer(html);
  return { filename: `rapport-carbone-mizancarbone-${new Date().toISOString().slice(0, 10)}.pdf`, buffer };
}

const NATURE_LABELS = {
  energie: 'Scope 1 / Scope 2',
  matiere_premiere: 'Matière première (traçabilité)',
  scope3_estimation: 'Scope 3 (estimation)',
};

// tCO2e numérique seulement quand le statut porte réellement une valeur ;
// vide pour manquant / non calculé — une cellule vide n'est jamais un zéro.
function scopeNumber(value, statusResult) {
  return statusResult.status === 'manquant' || statusResult.status === 'non_calcule' ? null : value;
}

function scopeStatusLabel(statusResult) {
  return formatStatusLabel(statusResult.status, {
    needsVerification: statusResult.needsVerification,
    incomplete: statusResult.hasUncalculatedEntries && statusResult.status !== 'non_calcule',
  });
}

// Même contenu que le rapport PDF et l'export CSV du tableau de bord,
// organisé en onglets pour une lecture et une analyse dans Excel.
export async function buildDashboardXlsxExport(companyId) {
  const [company, summary, factorsUsed, siteCount, periodRange, rows] = await Promise.all([
    getCompany(companyId),
    getEmissionsSummary(companyId),
    getFactorsUsedByCompany(companyId),
    getSiteCount(companyId),
    getReportingPeriodRange(companyId),
    getAllEntriesWithResults(companyId),
  ]);
  const completeness = await getDataCompleteness(companyId, company?.reporting_frequency ?? null);
  const today = new Date().toISOString().slice(0, 10);

  const workbook = await createWorkbook();
  addInfoSheet(workbook, 'Rapport carbone — données', [
    ['Entreprise', company?.name ?? '—'],
    ['Secteur', sectorLabel(company?.sector) ?? '—'],
    ['Période couverte', periodRange.entryCount > 0 ? `du ${periodRange.minStart} au ${periodRange.maxEnd}` : 'Aucune donnée saisie à ce jour'],
    ['Année de référence', company?.base_year ?? 'Non renseignée'],
    ['Nombre de sites', siteCount],
    ['Taux de données disponibles', completenessLabel(completeness)],
    ['Date de génération', today],
    ['Outil', TOOL_STATEMENT],
    ['Périmètre', 'Contrôle opérationnel (100 % des émissions des opérations contrôlées opérationnellement). Autres approches de consolidation non prises en charge.'],
    ['Méthode', 'Quantité × facteur d\'émission versionné, choisi selon la période exacte de chaque donnée. Ratios monétaires : montant MAD / 1000 × facteur kgCO2e/kMAD, sans conversion de devise. Scope 2 location-based et market-based présentés séparément, jamais additionnés.'],
    ['Scope 2 market-based', `${formatTco2e(summary.scope2MarketBasedTco2e)} tCO2e — ${summary.scope2MarketBased.fallbackNote}`],
    ['Scope 3', `Estimation partielle : ${summary.scope3Coverage.categoriesWithData} catégorie(s) sur 15 renseignée(s). Jamais un Scope 3 complet.`],
    ['Statuts', 'Réel : calculé à partir de données saisies · Estimé : estimation Scope 3 · Non calculé : donnée saisie sans facteur applicable · Manquant : aucune donnée · Contrôle interne partiel : anomalie signalée lors du contrôle interne. Une cellule tCO2e vide n\'est jamais un zéro.'],
    ['Statut du document', 'Document de préparation interne — MizanCarbone ne réalise aucune vérification.'],
  ]);

  const scope12Statuses = [summary.scope1Status, summary.scope2LocationBasedStatus];
  const isPartial = (statuses) => statuses.some((s) => s.status === 'manquant' || s.status === 'non_calcule' || s.hasUncalculatedEntries);
  const total12 = summary.scope1Tco2e + summary.scope2LocationBasedTco2e;
  const total123Partial = isPartial([...scope12Statuses, summary.scope3Status]);

  addTableSheet(
    workbook,
    'Synthèse par scope',
    [
      { header: 'Poste', key: 'poste', width: 34 },
      { header: 'tCO2e', key: 'tco2e', width: 14, numFmt: TCO2E_FORMAT },
      { header: 'Statut', key: 'status', width: 30 },
      { header: 'Remarque', key: 'note', width: 70 },
    ],
    [
      { poste: 'Scope 1', tco2e: scopeNumber(summary.scope1Tco2e, summary.scope1Status), status: scopeStatusLabel(summary.scope1Status), note: '' },
      { poste: 'Scope 2 — location-based', tco2e: scopeNumber(summary.scope2LocationBasedTco2e, summary.scope2LocationBasedStatus), status: scopeStatusLabel(summary.scope2LocationBasedStatus), note: '' },
      { poste: 'Scope 2 — market-based', tco2e: scopeNumber(summary.scope2MarketBasedTco2e, summary.scope2MarketBasedStatus), status: scopeStatusLabel(summary.scope2MarketBasedStatus), note: `Instruments admissibles : ${formatTco2e(summary.scope2MarketBased.admissibleKwh, { maximumFractionDigits: 0 })} kWh sur ${formatTco2e(summary.scope2MarketBased.consumptionKwh, { maximumFractionDigits: 0 })} kWh. Ne s'additionne jamais au location-based.` },
      { poste: 'Scope 3 — catégories renseignées (partiel)', tco2e: scopeNumber(summary.scope3Tco2e, summary.scope3Status), status: scopeStatusLabel(summary.scope3Status), note: `${summary.scope3Coverage.categoriesWithData} catégorie(s) sur 15 renseignée(s) — jamais un Scope 3 complet` },
      { poste: 'Total Scope 1 + 2 (location-based)', tco2e: isPartial(scope12Statuses) ? null : total12, status: isPartial(scope12Statuses) ? 'Partiel' : 'Réel', note: 'Indicateur affiché au tableau de bord' },
      // Le Scope 3 ne couvre jamais toutes les catégories : ce total n'est
      // jamais « Réel » ; s'il est chiffré, il porte sa couverture.
      {
        poste: 'Total Scope 1 + 2 + 3',
        tco2e: total123Partial ? null : total12 + summary.scope3Tco2e,
        status: `Partiel — Scope 3 limité à ${summary.scope3Coverage.categoriesWithData} catégorie(s) sur 15`,
        note: total123Partial
          ? "Au moins un poste n'est pas intégralement calculé — voir les statuts ci-dessus"
          : `Scope 1 et 2 complets ; Scope 3 partiel (${summary.scope3Coverage.categoriesWithData}/15 catégories renseignées)`,
      },
    ],
  );

  addTableSheet(
    workbook,
    'Scope 1 et 3 par poste',
    [
      { header: 'Poste', key: 'poste', width: 60 },
      { header: 'Pertinence déclarée', key: 'relevance', width: 22 },
      { header: 'tCO2e', key: 'tco2e', width: 14, numFmt: TCO2E_FORMAT },
      { header: 'Statut', key: 'status', width: 30 },
    ],
    [
      ...summary.scope1Breakdown.map((b) => ({ poste: `Scope 1 — ${b.label}`, relevance: '', tco2e: scopeNumber(b.tco2e, b), status: scopeStatusLabel(b) })),
      ...summary.scope3Breakdown.map((c) => ({
        poste: `Scope 3 — cat. ${c.category} — ${c.label}`,
        relevance: { pertinente: 'Pertinente', non_pertinente: 'Non pertinente', a_evaluer: 'À évaluer' }[c.relevance],
        tco2e: scopeNumber(c.tco2e, c),
        status: scopeStatusLabel(c),
      })),
    ],
  );

  addTableSheet(
    workbook,
    'Par site',
    [
      { header: 'Site', key: 'site', width: 36 },
      { header: 'tCO2e', key: 'tco2e', width: 14, numFmt: TCO2E_FORMAT },
    ],
    summary.bySite.map((s) => ({ site: s.siteName ?? 'Sans site', tco2e: s.totalTco2e })),
  );

  addTableSheet(
    workbook,
    'Par période',
    [
      { header: 'Début de période', key: 'start', width: 16 },
      { header: 'Fin de période', key: 'end', width: 16 },
      { header: 'tCO2e', key: 'tco2e', width: 14, numFmt: TCO2E_FORMAT },
    ],
    [...summary.byPeriod]
      .sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart)))
      .map((p) => ({ start: p.periodStart, end: p.periodEnd, tco2e: p.totalTco2e })),
  );

  addTableSheet(
    workbook,
    'Par produit',
    [
      { header: 'Produit', key: 'product', width: 36 },
      { header: 'tCO2e', key: 'tco2e', width: 14, numFmt: TCO2E_FORMAT },
    ],
    summary.byProduct.map((p) => ({ product: p.productAllocation ?? 'Non alloué', tco2e: p.totalTco2e })),
  );

  addTableSheet(
    workbook,
    'Données brutes',
    [
      { header: 'Nature', key: 'nature', width: 22 },
      { header: 'Site', key: 'site', width: 26 },
      { header: 'Début de période', key: 'start', width: 14 },
      { header: 'Fin de période', key: 'end', width: 14 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Quantité', key: 'quantity', width: 14, numFmt: '#,##0.##' },
      { header: 'Unité', key: 'unit', width: 9 },
      { header: 'Fournisseur', key: 'supplier', width: 18 },
      { header: 'Produit alloué', key: 'product', width: 22 },
      { header: 'Scope', key: 'scope', width: 8 },
      { header: 'tCO2e', key: 'tco2e', width: 12, numFmt: TCO2E_FORMAT },
      { header: 'Statut', key: 'status', width: 20 },
      { header: 'Source du facteur', key: 'factorSource', width: 50 },
      { header: 'Facteur national', key: 'isNational', width: 14 },
      { header: 'Document source', key: 'sourceDocument', width: 20 },
    ],
    rows.map((r) => {
      const kind = classifyEntry(r);
      const tco2e = r.tco2e === null ? null : Number(r.tco2e);
      let status;
      if (kind === 'scope3_estimation') {
        status = tco2e === null ? STATUS_LABELS.non_calcule : STATUS_LABELS.estime;
      } else {
        const line = determineLineStatus({ isRawMaterial: kind === 'matiere_premiere', tco2e, verificationStatus: r.verification_status });
        status = formatStatusLabel(line.status, { needsVerification: line.needsVerification });
      }
      return {
        nature: NATURE_LABELS[kind],
        site: r.site_name ?? '',
        start: r.period_start,
        end: r.period_end,
        description: kind === 'matiere_premiere' ? r.material_label : (r.factor_label ?? r.factor_code),
        quantity: Number(r.quantity),
        unit: kind === 'matiere_premiere' ? '' : (r.factor_unit ?? ''),
        supplier: r.supplier ?? '',
        product: r.product_allocation ?? '',
        scope: r.scope ?? '',
        tco2e,
        status,
        factorSource: r.factor_source ?? '',
        isNational: r.is_national === null ? '' : r.is_national ? 'oui' : 'non (générique)',
        sourceDocument: r.source_document ?? '',
      };
    }),
  );

  addTableSheet(
    workbook,
    'Facteurs utilisés',
    [
      { header: 'Scope', key: 'scope', width: 8 },
      { header: 'Facteur', key: 'label', width: 45 },
      { header: 'Valeur (kgCO2e par unité)', key: 'value', width: 18, numFmt: '0.000000' },
      { header: 'Unité', key: 'unit', width: 9 },
      { header: 'Périmètre', key: 'boundary', width: 28 },
      { header: 'Année représentée', key: 'year', width: 22 },
      { header: 'Utilisation retenue', key: 'validity', width: 24 },
      { header: 'Incertitude (%)', key: 'uncertainty', width: 14 },
      { header: 'Source', key: 'source', width: 70 },
      { header: 'Fichier / feuille / cellule', key: 'provenance', width: 60 },
      { header: 'Statut méthodologique', key: 'methodStatus', width: 22 },
      { header: 'Droits de réutilisation', key: 'rights', width: 30 },
      { header: 'Restrictions d’usage', key: 'restrictions', width: 90 },
    ],
    factorsUsed.map((f) => ({
      scope: f.scope,
      label: f.label,
      value: Number(f.value_kgco2e),
      unit: f.unit,
      boundary: BOUNDARY_LABELS[f.boundary] ?? 'Non renseigné',
      year: f.represented_year ?? 'Non renseignée',
      validity: `${isoDate(f.valid_from)} → ${isoDate(f.valid_to) ?? 'en cours'}`,
      uncertainty: f.uncertainty_pct === null ? '' : Number(f.uncertainty_pct),
      source: f.source,
      provenance: describeFactorProvenance(f),
      methodStatus: METHOD_STATUS_LABELS[f.methodological_status] ?? f.methodological_status,
      rights: RIGHTS_LABELS[f.rights_status] ?? f.rights_status,
      restrictions: f.usage_restrictions ?? '',
    })),
  );

  return { filename: `rapport-carbone-mizancarbone-${today}.xlsx`, buffer: await workbookToBuffer(workbook) };
}
