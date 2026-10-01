import { pool } from '../../config/db.js';
import { getEmissionsSummary } from '../calculation/calculation.service.js';
import { getDataCompleteness } from './dashboard-analytics.service.js';
import { renderBrandedHtml, htmlToPdfBuffer } from './pdf-template.js';
import { STATUS_LABELS, formatStatusLabel, formatTco2e } from './report-formatting.js';

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
  return 'energie';
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function buildRawDataCsvExport(companyId) {
  const rows = await getAllEntriesWithResults(companyId);
  const headers = [
    'id', 'nature', 'site', 'periode_debut', 'periode_fin', 'description', 'quantite', 'unite',
    'fournisseur', 'produit_alloue', 'scope', 'tco2e', 'source_facteur', 'facteur_national',
    'statut_verification', 'document_source', 'cree_le',
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
    `SELECT DISTINCT ef.code, ef.label, ef.scope, ef.unit, ef.value_kgco2e, ef.source, ef.is_national
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
  const [company, summary, factorsUsed, siteCount, periodRange] = await Promise.all([
    getCompany(companyId),
    getEmissionsSummary(companyId),
    getFactorsUsedByCompany(companyId),
    getSiteCount(companyId),
    getReportingPeriodRange(companyId),
  ]);

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
        <td>${escapeCell(f.label)}</td>
        <td class="mono">${formatTco2e(f.value_kgco2e, { maximumFractionDigits: 6 })} kgCO2e/${escapeCell(f.unit)}</td>
        <td>${escapeCell(f.source)}${!f.is_national ? ' <span class="badge-generique">générique</span>' : ''}</td>
      </tr>`)
    .join('');

  const summaryHtml = `
    <h2>Résumé exécutif</h2>
    <div class="kpi-grid">
      <div class="kpi-tile"><div class="kpi-label">Entreprise</div><div class="kpi-value">${escapeCell(company?.name ?? '—')}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Secteur</div><div class="kpi-value">${escapeCell(company?.sector ?? '—')}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Période couverte</div><div class="kpi-value mono">${escapeCell(periodLabel)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Année de référence</div><div class="kpi-value mono">${company?.base_year ?? 'Non renseignée'}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Nombre de sites</div><div class="kpi-value mono">${siteCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Scope 1</div><div class="kpi-value mono">${scopeValueCell(summary.scope1Tco2e, summary.scope1Status)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Scope 2 (location-based)</div><div class="kpi-value mono">${scopeValueCell(summary.scope2LocationBasedTco2e, summary.scope2LocationBasedStatus)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Scope 3 (estimé)</div><div class="kpi-value mono">${scopeValueCell(summary.scope3Tco2e, summary.scope3Status)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Total tCO2e${totalIsPartial ? ' (partiel)' : ''}</div><div class="kpi-value mono">${totalIsPartial ? 'Partiel — voir statuts ci-dessous' : formatTco2e(totalTco2e)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Taux de données disponibles</div><div class="kpi-value mono">${escapeCell(completenessLabel(completeness))}</div></div>
    </div>
    <p class="mono" style="font-size:10.5px;color:#5B6670;">
      Périmètre organisationnel : contrôle opérationnel (l'entreprise comptabilise 100% des émissions des sites
      qu'elle contrôle opérationnellement). Structuré selon le GHG Protocol / ISO 14064-1.
    </p>
    <div class="page-break"></div>
  `;

  const bodyHtml = `
    ${summaryHtml}
    <p>
      Année de référence (base year) : <span class="mono">${company?.base_year ?? 'non renseignée'}</span>.
      Ce rapport est un outil de préparation interne — il n'a pas vocation à constituer une vérification
      tierce accréditée (ISO 14065).
    </p>

    <h2>Émissions par scope</h2>
    <table>
      <thead><tr><th>Poste</th><th>tCO2e</th><th>Statut</th></tr></thead>
      <tbody>
        <tr><td>Scope 1</td><td class="mono">${scopeValueCell(summary.scope1Tco2e, summary.scope1Status)}</td><td>${statusTag(summary.scope1Status)}</td></tr>
        <tr><td>Scope 2 — location-based</td><td class="mono">${scopeValueCell(summary.scope2LocationBasedTco2e, summary.scope2LocationBasedStatus)}</td><td>${statusTag(summary.scope2LocationBasedStatus)}</td></tr>
        <tr><td>Scope 2 — market-based</td><td class="mono">${scopeValueCell(summary.scope2MarketBasedTco2e, summary.scope2MarketBasedStatus)}${summary.scope2MarketBasedIsDefaulted ? ' (identique au location-based, par défaut)' : ''}</td><td>${statusTag(summary.scope2MarketBasedStatus)}</td></tr>
        <tr><td>Scope 3 — estimation</td><td class="mono">${scopeValueCell(summary.scope3Tco2e, summary.scope3Status)}</td><td>${statusTag(summary.scope3Status)}</td></tr>
      </tbody>
    </table>
    ${summary.scope3Uncertainty ? `<div class="callout">Scope 3 — estimation, incertitude ${summary.scope3Uncertainty.minPercent}–${summary.scope3Uncertainty.maxPercent}% (approche spend-based ADEME). Jamais présentée avec le même niveau de confiance que le Scope 1/2.</div>` : ''}

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

    <h2>Annexe — méthodologie et facteurs d'émission utilisés</h2>
    <p>
      Chaque facteur ci-dessous référence sa source, comme exigé pour toute donnée utilisée dans un
      calcul de ce rapport. Les facteurs marqués « générique » sont des valeurs internationales
      (GHG Protocol/IEA) à remplacer par l'équivalent marocain (Outil Bilan Carbone Maroc) dès disponible.
    </p>
    <table>
      <thead><tr><th>Scope</th><th>Facteur</th><th>Valeur</th><th>Source</th></tr></thead>
      <tbody>${factorsRows || '<tr><td colspan="4">Aucun facteur utilisé pour le moment.</td></tr>'}</tbody>
    </table>

    <h2>Méthodologie et limites</h2>
    <p>
      <b>Périmètre :</b> contrôle opérationnel (100% des émissions des sites contrôlés opérationnellement par
      l'entreprise). <b>Méthode :</b> Scope 1/2 calculés ligne par ligne (quantité × facteur d'émission versionné,
      sélectionné selon la période exacte de chaque donnée saisie) ; Scope 3 estimé globalement par une approche
      spend-based (dépenses × ratio sectoriel ADEME Base Empreinte), jamais ligne par ligne.
      <b>Données estimées :</b> l'intégralité du Scope 3 (voir incertitude ci-dessus) — jamais présentée avec la
      même confiance qu'un calcul direct. <b>Données manquantes :</b> tout poste marqué « Manquant » ci-dessus
      n'a reçu aucune saisie ; tout poste marqué « Non calculé » a des données saisies mais aucun facteur
      d'émission disponible pour leur période exacte. <b>Limites :</b> ce rapport ne couvre que les données
      effectivement saisies dans mizancarbone ; il ne garantit pas l'exhaustivité du périmètre réel de
      l'entreprise. <b>Statut du rapport :</b> ce rapport est un outil de préparation interne — il n'a pas
      vocation à constituer une vérification tierce accréditée (ISO 14065).
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
