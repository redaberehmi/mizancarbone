import { pool } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { renderBrandedHtml, htmlToPdfBuffer } from '../reports/pdf-template.js';
import { formatStatusLabel, formatTco2e, formatTco2eCell, determineLineStatus } from '../reports/report-formatting.js';
import { CBAM_COVERED_SECTORS, CBAM_OFFICIAL_CATEGORIES } from './constants.js';

// Phrase de cadrage réutilisée partout (UI, CSV, PDF) — jamais reformulée
// au cas par cas, pour ne jamais risquer une dérive de vocabulaire (section
// 8). Le déclarant CBAM est toujours l'importateur européen, jamais
// l'exportateur marocain : cet outil structure des données réutilisables
// par l'entreprise dans ses échanges avec son client, il ne transmet rien
// à une autorité ou un registre.
export const CBAM_FRAMING_NOTE =
  "Ce document rassemble des données de préparation carbone structurées selon le GHG Protocol / ISO 14064-1, " +
  "prêtes à être réutilisées dans vos échanges avec vos clients européens. mizancarbone reste un outil de " +
  "préparation interne : aucune transmission automatique à une autorité ou un registre.";

// Rappel explicite du positionnement V1, distinct de CBAM_FRAMING_NOTE (qui
// dit ce que l'outil FAIT) : celui-ci dit ce qu'il NE fait PAS, pour ne
// jamais laisser un lecteur pressé croire que ce document équivaut à une
// démarche officielle. Reformulé sans le terme verrouillé lié à une
// soumission officielle (voir constants.js, FORBIDDEN_PHRASES) — le mot
// "déclarant" reste autorisé, lui seul.
export const CBAM_NOT_OFFICIAL_NOTE =
  "Ce document ne constitue pas un dépôt réglementaire officiel au titre du CBAM et ne remplace pas les " +
  "procédures, registres ou vérifications réglementaires applicables — le déclarant CBAM reste exclusivement " +
  "l'importateur européen. Le calcul avancé des émissions intégrées par produit / code SH n'est pas réalisé " +
  "dans cette version : ce document reste un rapport de préparation des données, pas un moteur CBAM.";

// Distingue explicitement les lignes "matière première" (traçabilité
// uniquement) des lignes "énergie" (tCO2e calculé) — une valeur absente ne
// doit jamais être lue comme "émissions nulles vérifiées".
export const CBAM_METHODOLOGY_NOTE =
  "Les lignes « matière première » sont des données de traçabilité (quantité, fournisseur) : elles n'incluent " +
  "aucune émission calculée ligne par ligne — le Scope 3 est estimé globalement au module Calcul des émissions, " +
  "pas matière par matière. Une valeur tCO2e absente signifie « non calculé », jamais « émissions nulles vérifiées ».";

async function getCompany(companyId) {
  const result = await pool.query('SELECT id, name, sector FROM companies WHERE id = $1', [companyId]);
  if (result.rows.length === 0) throw new AppError(404, 'Entreprise introuvable.');
  return result.rows[0];
}

export async function getSectorRelevance(companyId) {
  const company = await getCompany(companyId);
  return {
    sector: company.sector,
    isCoveredSector: CBAM_COVERED_SECTORS.includes(company.sector),
    officialCategories: CBAM_OFFICIAL_CATEGORIES,
  };
}

export async function listDistinctProducts(companyId) {
  const result = await pool.query(
    `SELECT DISTINCT product_allocation FROM activity_entries
     WHERE company_id = $1 AND product_allocation IS NOT NULL AND deleted_at IS NULL
     ORDER BY product_allocation`,
    [companyId],
  );
  return result.rows.map((r) => r.product_allocation);
}

async function getPreparationEntries(companyId) {
  const result = await pool.query(
    `SELECT ae.id, ae.site_id, s.name AS site_name, ae.period_start, ae.period_end,
            ae.factor_code, ae.quantity, ae.material_label, ae.supplier,
            ae.product_allocation, ae.source_document,
            ef.label AS factor_label, ef.unit AS factor_unit, ef.is_national, ef.source AS factor_source,
            er.tco2e, er.verification_status
     FROM activity_entries ae
     LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
     LEFT JOIN emission_factors ef ON ef.id = er.emission_factor_id
     LEFT JOIN sites s ON s.id = ae.site_id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
       AND ae.factor_code NOT LIKE 'scope3_ratio_%'
     ORDER BY ae.product_allocation NULLS LAST, ae.period_start`,
    [companyId],
  );

  return result.rows.map((row) => {
    const isRawMaterial = row.material_label !== null;
    const tco2e = isRawMaterial ? null : row.tco2e !== null ? Number(row.tco2e) : null;
    const { status, needsVerification } = determineLineStatus({
      isRawMaterial,
      tco2e,
      verificationStatus: row.verification_status,
    });
    return {
      id: row.id,
      kind: isRawMaterial ? 'matiere_premiere' : 'energie',
      product: row.product_allocation,
      siteId: row.site_id,
      siteName: row.site_name,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      // factor_label vient de emission_results -> emission_factors : NULL
      // tant que la ligne n'est pas calculée (pas de facteur associé pour
      // l'instant). Repli sur factor_code (ex. "gasoline_L") pour ne jamais
      // laisser une ligne "Non calculé" sans description — exactement le
      // cas où la traçabilité compte le plus. Même repli déjà utilisé côté
      // Bilan Carbone (reports.service.js, classifyEntry) : trouvé absent
      // ici lors d'une vérification visuelle du PDF réel, corrigé pour que
      // les deux rapports se comportent pareil sur la même donnée.
      description: isRawMaterial ? row.material_label : (row.factor_label ?? row.factor_code),
      quantity: Number(row.quantity),
      unit: isRawMaterial ? null : row.factor_unit,
      supplier: row.supplier,
      sourceDocument: row.source_document,
      tco2e,
      isNational: isRawMaterial ? null : row.is_national,
      factorSource: isRawMaterial ? null : row.factor_source,
      verificationStatus: row.verification_status,
      status,
      needsVerification,
    };
  });
}

// Checklist informative (point 7 de la demande d'amélioration) — chaque
// case est dérivée de compteurs réels sur les données déjà présentes, jamais
// d'une case cochée par défaut. "Données de production disponibles" est
// volontairement absente : le modèle de données V1 ne collecte aucune
// quantité de production distincte des lignes énergie/matière première —
// ce n'est pas une case à zéro, c'est un champ qui n'existe pas encore (voir
// notDataCollected ci-dessous, à traiter en V2 si nécessaire, jamais fabriqué ici).
function buildChecklist(entries, groups) {
  const energieEntries = entries.filter((e) => e.kind === 'energie');
  const matierePremiereEntries = entries.filter((e) => e.kind === 'matiere_premiere');
  const energieCalculees = energieEntries.filter((e) => e.tco2e !== null);
  const energieNonCalculees = energieEntries.filter((e) => e.tco2e === null);
  const nonAlloueGroup = groups.find((g) => g.product === null);
  const aVerifier = entries.filter((e) => e.needsVerification);

  return {
    energieDisponible: energieEntries.length > 0,
    productionDisponible: null, // non applicable : aucune donnée de production distincte collectée en V1
    produitDisponible: groups.some((g) => g.product !== null),
    matierePremiereDisponible: matierePremiereEntries.length > 0,
    facteursDocumentes: energieCalculees.length > 0,
    donneesManquantes: {
      energieNonCalculeeCount: energieNonCalculees.length,
      nonAlloueCount: nonAlloueGroup ? nonAlloueGroup.entries.length : 0,
    },
    aVerifierCount: aVerifier.length,
    notDataCollected: [
      "Quantités de production (volume/tonnage produit) : aucun champ dédié dans le modèle de données V1, " +
        "distinct des lignes énergie et matière première déjà collectées.",
    ],
  };
}

export async function getPreparationSummary(companyId) {
  const entries = await getPreparationEntries(companyId);
  const groups = new Map();

  for (const entry of entries) {
    const key = entry.product ?? 'non-alloue';
    if (!groups.has(key)) {
      groups.set(key, { product: entry.product, energieTco2eTotal: 0, energieCount: 0, matierePremiereCount: 0, entries: [] });
    }
    const group = groups.get(key);
    group.entries.push(entry);
    if (entry.kind === 'energie') {
      group.energieCount += 1;
      group.energieTco2eTotal += entry.tco2e ?? 0;
    } else {
      group.matierePremiereCount += 1;
    }
  }

  const groupsArray = [...groups.values()];

  return {
    methodologyNote: CBAM_METHODOLOGY_NOTE,
    notOfficialNote: CBAM_NOT_OFFICIAL_NOTE,
    groups: groupsArray,
    entries,
    checklist: buildChecklist(entries, groupsArray),
  };
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function buildCsvExport(companyId) {
  const { entries } = await getPreparationSummary(companyId);
  const headers = [
    'produit', 'site', 'periode_debut', 'periode_fin', 'nature', 'description',
    'quantite', 'unite', 'fournisseur', 'tco2e', 'source_facteur', 'facteur_national', 'statut_verification',
  ];

  const lines = [
    csvEscape(CBAM_FRAMING_NOTE + ' ' + CBAM_METHODOLOGY_NOTE),
    '',
    headers.join(','),
    ...entries.map((e) => [
      csvEscape(e.product ?? 'Non alloué'),
      csvEscape(e.siteName ?? ''),
      csvEscape(e.periodStart),
      csvEscape(e.periodEnd),
      csvEscape(e.kind === 'energie' ? 'Énergie (calculé)' : 'Matière première (traçabilité, non calculé)'),
      csvEscape(e.description ?? ''),
      csvEscape(e.quantity),
      csvEscape(e.unit ?? ''),
      csvEscape(e.supplier ?? ''),
      csvEscape(e.tco2e === null ? '' : e.tco2e),
      csvEscape(e.factorSource ?? ''),
      csvEscape(e.isNational === null ? '' : e.isNational ? 'oui' : 'non'),
      csvEscape(e.verificationStatus ?? ''),
    ].join(',')),
  ];

  return { filename: `donnees-preparation-cbam-${new Date().toISOString().slice(0, 10)}.csv`, content: lines.join('\n') };
}

function checklistRow(label, available, note) {
  if (available === null) {
    return `<tr><td>${escapeCell(label)}</td><td><span class="status-tag" data-status="manquant">Non applicable en V1</span></td><td>${escapeCell(note ?? '')}</td></tr>`;
  }
  const tag = available
    ? '<span class="status-tag" data-status="reel">Disponible</span>'
    : '<span class="status-tag" data-status="manquant">Manquant</span>';
  return `<tr><td>${escapeCell(label)}</td><td>${tag}</td><td>${escapeCell(note ?? '')}</td></tr>`;
}

// Ligne dédiée plutôt qu'un détournement de checklistRow : "Éléments à
// vérifier" n'est pas une question de disponibilité de donnée (le sens de
// available/manquant ailleurs dans cette checklist) — zéro élément à
// vérifier est une bonne nouvelle, pas une donnée "Manquante", et un tag
// "Disponible" en face serait au mieux ambigu, au pire lu à l'envers
// (trouvé en vérification visuelle du PDF réel).
function verificationRow(count) {
  const tag = count === 0
    ? '<span class="status-tag" data-status="reel">Aucun</span>'
    : `<span class="status-tag" data-status="non_calcule">${count} à vérifier</span>`;
  const detail = count > 0
    ? `${count} ligne(s) marquée(s) « partiellement vérifiée »`
    : 'Aucune ligne marquée à vérifier';
  return `<tr><td>Éléments à vérifier</td><td>${tag}</td><td>${escapeCell(detail)}</td></tr>`;
}

// Séparée de buildPdfExport pour être testable directement (même
// discipline que buildReportHtml côté Bilan Carbone) et pour permettre un
// test de cohérence entre les deux rapports sur une même donnée source.
export async function buildPreparationReportHtml(companyId) {
  const company = await getCompany(companyId);
  const { groups, entries, checklist } = await getPreparationSummary(companyId);

  const energieCount = entries.filter((e) => e.kind === 'energie').length;
  const matierePremiereCount = entries.filter((e) => e.kind === 'matiere_premiere').length;
  const energieTco2eTotal = groups.reduce((sum, g) => sum + g.energieTco2eTotal, 0);
  const products = groups.filter((g) => g.product !== null).map((g) => g.product);
  const periodStarts = entries.map((e) => e.periodStart).filter(Boolean).sort();
  const periodEnds = entries.map((e) => e.periodEnd).filter(Boolean).sort();
  const periodLabel = entries.length > 0
    ? `du ${periodStarts[0]} au ${periodEnds[periodEnds.length - 1]}`
    : 'Aucune donnée saisie à ce jour';

  // Statut global — jamais une note de maturité fabriquée ("avancé",
  // "complet") : uniquement 3 constats vérifiables directement dans les
  // compteurs ci-dessus.
  const globalStatus = entries.length === 0
    ? 'Aucune donnée saisie pour le moment.'
    : checklist.donneesManquantes.energieNonCalculeeCount > 0 || checklist.donneesManquantes.nonAlloueCount > 0
      ? 'Préparation en cours — données partielles (voir « Données manquantes » ci-dessous).'
      : 'Données de base réunies pour les lignes saisies — vérification manuelle recommandée avant transmission.';

  const summaryHtml = `
    <h2>Résumé exécutif</h2>
    <div class="kpi-grid">
      <div class="kpi-tile"><div class="kpi-label">Entreprise</div><div class="kpi-value">${escapeCell(company.name)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Secteur</div><div class="kpi-value">${escapeCell(company.sector)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Période couverte</div><div class="kpi-value mono">${escapeCell(periodLabel)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Produits identifiés</div><div class="kpi-value mono">${products.length > 0 ? escapeCell(products.join(', ')) : 'Non renseigné'}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Lignes énergie</div><div class="kpi-value mono">${energieCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Lignes matière première</div><div class="kpi-value mono">${matierePremiereCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Émissions énergétiques calculées</div><div class="kpi-value mono">${formatTco2e(energieTco2eTotal)} tCO2e</div></div>
      <div class="kpi-tile"><div class="kpi-label">Données manquantes</div><div class="kpi-value mono">${checklist.donneesManquantes.energieNonCalculeeCount} non calculée(s) · ${checklist.donneesManquantes.nonAlloueCount} non allouée(s)</div></div>
    </div>
    <p style="font-size:11px;"><b>Statut global de préparation :</b> ${escapeCell(globalStatus)}</p>
    <div class="page-break"></div>
  `;

  const checklistHtml = `
    <h2>Préparation CBAM — état des données disponibles</h2>
    <table>
      <thead><tr><th>Élément</th><th>Statut</th><th>Détail</th></tr></thead>
      <tbody>
        ${checklistRow('Données énergétiques disponibles', checklist.energieDisponible)}
        ${checklistRow('Données de production disponibles', checklist.productionDisponible, checklist.notDataCollected[0])}
        ${checklistRow('Données produit disponibles', checklist.produitDisponible)}
        ${checklistRow('Données matière première disponibles', checklist.matierePremiereDisponible)}
        ${checklistRow('Facteurs d’émission documentés', checklist.facteursDocumentes)}
        ${verificationRow(checklist.aVerifierCount)}
      </tbody>
    </table>
    <div class="callout">Cette checklist reflète uniquement les données réellement présentes dans le système — une case « Manquant » ou « Non applicable en V1 » n'est jamais reformulée en donnée positive.</div>
  `;

  const groupsHtml = groups
    .map((g) => {
      const rows = g.entries
        .map((e) => `
          <tr>
            <td>${e.siteName ?? '—'}</td>
            <td class="mono">${e.periodStart} → ${e.periodEnd}</td>
            <td>${e.kind === 'energie' ? 'Énergie (calculé)' : 'Matière première (traçabilité)'}</td>
            <td>${escapeCell(e.description)}</td>
            <td class="mono">${e.quantity}${e.unit ? ` ${e.unit}` : ''}</td>
            <td>${escapeCell(e.factorSource ?? '—')}</td>
            <td class="mono">${formatTco2eCell(e.tco2e)}</td>
            <td><span class="status-tag" data-status="${e.status}">${escapeCell(formatStatusLabel(e.status, { needsVerification: e.needsVerification }))}</span></td>
          </tr>`)
        .join('');
      const isUnallocated = g.product === null;
      return `
        <h2>${escapeCell(g.product ?? 'Non alloué')}</h2>
        ${isUnallocated
          ? '<div class="callout">Émissions calculées mais non encore attribuées à un produit / périmètre spécifique. L’affectation à un produit reste manuelle dans cette version : aucune allocation automatique n’est appliquée.</div>'
          : ''}
        <p class="mono">Total énergie calculé : ${formatTco2e(g.energieTco2eTotal)} tCO2e · ${g.matierePremiereCount} ligne(s) matière première (traçabilité, non calculé au niveau de la ligne)</p>
        <table>
          <thead><tr><th>Site</th><th>Période</th><th>Nature</th><th>Description</th><th>Quantité</th><th>Source du facteur</th><th>tCO2e</th><th>Statut</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join('');

  const bodyHtml = `
    ${summaryHtml}
    <p>${CBAM_FRAMING_NOTE}</p>
    <div class="callout">${CBAM_NOT_OFFICIAL_NOTE}</div>
    <div class="callout">${CBAM_METHODOLOGY_NOTE}</div>
    ${checklistHtml}
    <h2>Données par produit</h2>
    ${groupsHtml || '<p>Aucune donnée à exporter pour le moment.</p>'}
  `;

  return renderBrandedHtml({
    title: 'Données de préparation CBAM',
    companyName: company.name,
    generatedAtLabel: new Date().toLocaleDateString('fr-FR'),
    bodyHtml,
  });
}

export async function buildPdfExport(companyId) {
  const html = await buildPreparationReportHtml(companyId);
  const buffer = await htmlToPdfBuffer(html);
  return { filename: `donnees-preparation-cbam-${new Date().toISOString().slice(0, 10)}.pdf`, buffer };
}

function escapeCell(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
