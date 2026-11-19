import { pool } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { renderBrandedHtml, htmlToPdfBuffer } from '../reports/pdf-template.js';
import { csvEscape } from '../reports/csv-escape.js';
import { listProcesses } from './cbam-production.service.js';

// Procédés CBAM (émissions intrinsèques) repris dans les trois exports, avec
// leur statut et ce qui manque — jamais un chiffre pour un cas non pris en
// charge ou incomplet.
const PROCESS_STATUS_LABELS = {
  calcule_valeurs_reelles: "Calculé (valeurs réelles de l'installation, bien simple)",
  incomplet: 'Incomplet',
  non_pris_en_charge: 'Non pris en charge',
};

export const CBAM_PROCESS_NOTE =
  "Émissions intrinsèques par procédé : calculées uniquement pour les biens simples, à partir des seules données de l'installation rattachées au procédé (part attribuée documentée), divisées par la production du procédé. Aucune valeur par défaut n'est substituée. Ces valeurs doivent être vérifiées par un vérificateur accrédité.";

function processRows(processes) {
  return processes.map((p) => ({
    installation: p.installationName,
    process: p.name,
    product: p.productName,
    cnCode: p.cnCode,
    period: `${p.periodStart} → ${p.periodEnd}`,
    production: p.productionTonnes,
    status: PROCESS_STATUS_LABELS[p.status],
    direct: p.attributedDirectTco2e,
    indirect: p.attributedIndirectTco2e,
    seeDirect: p.specificDirectEmissions,
    seeIndirect: p.specificIndirectEmissions,
    gaps: [...p.unsupported, ...p.missing].join(' ; '),
  }));
}
import { formatStatusLabel, formatTco2e, formatTco2eCell, determineLineStatus } from '../reports/report-formatting.js';
import { CBAM_COVERED_SECTORS, CBAM_OFFICIAL_CATEGORIES } from './constants.js';
import { sectorLabel, createWorkbook, addInfoSheet, addTableSheet, workbookToBuffer, TCO2E_FORMAT } from '../reports/xlsx-helpers.js';

// Phrase de cadrage réutilisée partout (UI, CSV, PDF) — jamais reformulée
// au cas par cas, pour ne jamais risquer une dérive de vocabulaire (section
// 8). Le déclarant CBAM est toujours l'importateur européen, jamais
// l'exportateur marocain : cet outil structure des données réutilisables
// par l'entreprise dans ses échanges avec son client, il ne transmet rien
// à une autorité ou un registre.
export const CBAM_FRAMING_NOTE =
  "Finalité : préparation de données pour vos échanges avec vos clients européens. Méthode : données d'activité " +
  "et émissions du bilan organisationnel, regroupées par produit alloué — ce n'est pas un calcul des émissions " +
  "intrinsèques des marchandises. Sources : facteurs listés avec leur provenance. Complétude : voir la checklist. " +
  "Aucune transmission à une autorité ou à un registre.";

// Rappel explicite du positionnement V1, distinct de CBAM_FRAMING_NOTE (qui
// dit ce que l'outil FAIT) : celui-ci dit ce qu'il NE fait PAS, pour ne
// jamais laisser un lecteur pressé croire que ce document équivaut à une
// démarche officielle. Reformulé sans le terme verrouillé lié à une
// soumission officielle (voir constants.js, FORBIDDEN_PHRASES) — le mot
// "déclarant" reste autorisé, lui seul.
export const CBAM_NOT_OFFICIAL_NOTE =
  "Ce document ne constitue pas un dépôt réglementaire officiel au titre du CBAM et ne remplace pas les " +
  "procédures, registres ou vérifications réglementaires applicables — le déclarant CBAM reste exclusivement " +
  "l'importateur européen. Ce document reste un rapport de préparation des données. Les émissions intrinsèques par procédé (règlement d'exécution (UE) 2025/2547) sont " +
  "préparées séparément, uniquement pour les biens simples et avec les éléments manquants signalés ; le " +
  "règlement 2023/1773 ne concernait que la période transitoire.";

// Distingue explicitement les lignes "matière première" (traçabilité
// uniquement) des lignes "énergie" (tCO2e calculé) — une valeur absente ne
// doit jamais être lue comme "émissions nulles vérifiées".
export const CBAM_METHODOLOGY_NOTE =
  "Les lignes « matière première » sont des données de traçabilité (quantité, fournisseur) : elles n'incluent " +
  "aucune émission calculée ligne par ligne. Les achats de matières ne sont comptés en Scope 3 que s'ils sont " +
  "saisis comme achats avec un facteur explicite. Une valeur tCO2e absente signifie « non calculé », jamais « zéro ».";

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
       -- Les données Scope 3 (achats, fret, déchets…) ne relèvent pas des
       -- émissions d'une installation : jamais reprises dans ce document.
       AND NOT EXISTS (
         SELECT 1 FROM emission_factors ef3 WHERE ef3.code = ae.factor_code AND ef3.scope = 3
       )
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

export async function buildCsvExport(companyId) {
  const { entries } = await getPreparationSummary(companyId);
  const headers = [
    'produit', 'site', 'periode_debut', 'periode_fin', 'nature', 'description',
    'quantite', 'unite', 'fournisseur', 'tco2e', 'source_facteur', 'facteur_national', 'statut_controle_interne',
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

  const processes = processRows(await listProcesses(companyId));
  lines.push(
    '',
    csvEscape(CBAM_PROCESS_NOTE),
    ['installation', 'procede', 'produit', 'code_nc', 'periode', 'production_t', 'statut', 'emissions_directes_tco2e',
      'emissions_indirectes_tco2e', 'emissions_specifiques_directes_tco2e_par_t', 'emissions_specifiques_indirectes_tco2e_par_t', 'elements_manquants_ou_non_pris_en_charge'].join(','),
    ...processes.map((r) => [r.installation, r.process, r.product, r.cnCode, r.period, r.production ?? '', r.status,
      r.direct ?? '', r.indirect ?? '', r.seeDirect ?? '', r.seeIndirect ?? '', r.gaps].map(csvEscape).join(',')),
  );

  return { filename: `donnees-preparation-cbam-${new Date().toISOString().slice(0, 10)}.csv`, content: lines.join('\n') };
}

// Mêmes données que l'export CSV (getPreparationSummary), présentées pour
// une lecture humaine : un onglet par usage, notes de cadrage en tête.
// tCO2e reste numérique (vide si non calculé) et la colonne Statut porte le
// libellé — une cellule vide n'est jamais lue comme un zéro.
export async function buildXlsxExport(companyId) {
  const company = await getCompany(companyId);
  const { groups, entries, checklist } = await getPreparationSummary(companyId);
  const today = new Date().toISOString().slice(0, 10);

  const workbook = await createWorkbook();
  addInfoSheet(workbook, 'Données de préparation CBAM', [
    ['Entreprise', company.name],
    ['Secteur', sectorLabel(company.sector)],
    ['Date de génération', today],
    ['Positionnement', CBAM_FRAMING_NOTE],
    ["Ce que ce document n'est pas", CBAM_NOT_OFFICIAL_NOTE],
    ['Méthode', CBAM_METHODOLOGY_NOTE],
    ['Statuts', "Réel : calculé à partir de données saisies · Non calculé : donnée saisie sans résultat d'émission (matière première, ou facteur indisponible pour la période) · Contrôle interne partiel : anomalie signalée lors du contrôle interne."],
    ['Onglets', 'Synthèse par produit · Détail des lignes · Checklist · Sources des facteurs'],
  ]);

  addTableSheet(
    workbook,
    'Synthèse par produit',
    [
      { header: 'Produit', key: 'product', width: 32 },
      { header: 'Lignes énergie', key: 'energieCount', width: 16 },
      { header: 'tCO2e énergie (calculé)', key: 'energieTco2e', width: 22, numFmt: TCO2E_FORMAT },
      { header: 'Lignes énergie non calculées', key: 'nonCalcule', width: 24 },
      { header: 'Lignes matière première (traçabilité)', key: 'matiereCount', width: 30 },
    ],
    groups.map((g) => ({
      product: g.product ?? 'Non alloué',
      energieCount: g.energieCount,
      energieTco2e: g.energieTco2eTotal,
      nonCalcule: g.entries.filter((e) => e.kind === 'energie' && e.tco2e === null).length,
      matiereCount: g.matierePremiereCount,
    })),
  );

  addTableSheet(
    workbook,
    'Détail des lignes',
    [
      { header: 'Produit', key: 'product', width: 24 },
      { header: 'Site', key: 'site', width: 26 },
      { header: 'Début de période', key: 'periodStart', width: 14 },
      { header: 'Fin de période', key: 'periodEnd', width: 14 },
      { header: 'Nature', key: 'nature', width: 22 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Quantité', key: 'quantity', width: 14, numFmt: '#,##0.##' },
      { header: 'Unité', key: 'unit', width: 9 },
      { header: 'Fournisseur', key: 'supplier', width: 18 },
      { header: 'tCO2e', key: 'tco2e', width: 12, numFmt: TCO2E_FORMAT },
      { header: 'Statut', key: 'status', width: 20 },
      { header: 'Source du facteur', key: 'factorSource', width: 50 },
      { header: 'Facteur national', key: 'isNational', width: 12 },
      { header: 'Document source', key: 'sourceDocument', width: 20 },
    ],
    entries.map((e) => ({
      product: e.product ?? 'Non alloué',
      site: e.siteName ?? '',
      periodStart: e.periodStart,
      periodEnd: e.periodEnd,
      nature: e.kind === 'energie' ? 'Énergie' : 'Matière première (traçabilité)',
      description: e.description ?? '',
      quantity: e.quantity,
      unit: e.unit ?? '',
      supplier: e.supplier ?? '',
      tco2e: e.tco2e,
      status: formatStatusLabel(e.status, { needsVerification: e.needsVerification }),
      factorSource: e.factorSource ?? '',
      isNational: e.isNational === null ? '' : e.isNational ? 'oui' : 'non (générique)',
      sourceDocument: e.sourceDocument ?? '',
    })),
  );

  const availability = (value) => (value === null ? 'Non applicable en V1' : value ? 'Disponible' : 'Manquant');
  addTableSheet(
    workbook,
    'Checklist',
    [
      { header: 'Élément', key: 'item', width: 40 },
      { header: 'État', key: 'state', width: 22 },
      { header: 'Détail', key: 'detail', width: 80 },
    ],
    [
      { item: 'Données énergie', state: availability(checklist.energieDisponible), detail: `${checklist.donneesManquantes.energieNonCalculeeCount} ligne(s) énergie non calculée(s)` },
      { item: 'Données de production', state: availability(checklist.productionDisponible), detail: checklist.notDataCollected.join(' ') },
      { item: 'Produits renseignés', state: availability(checklist.produitDisponible), detail: `${checklist.donneesManquantes.nonAlloueCount} ligne(s) non allouée(s) à un produit` },
      { item: 'Matières premières tracées', state: availability(checklist.matierePremiereDisponible), detail: '' },
      { item: 'Facteurs documentés', state: availability(checklist.facteursDocumentes), detail: 'Voir l\'onglet « Sources des facteurs »' },
      { item: 'Contrôle interne', state: checklist.aVerifierCount === 0 ? 'Aucune anomalie signalée' : `${checklist.aVerifierCount} anomalie(s) signalée(s)`, detail: '' },
    ],
  );

  const factorSources = new Map();
  for (const e of entries) {
    if (e.kind !== 'energie' || !e.factorSource) continue;
    const key = `${e.description}|${e.factorSource}`;
    if (!factorSources.has(key)) {
      factorSources.set(key, { description: e.description, unit: e.unit ?? '', source: e.factorSource, isNational: e.isNational ? 'oui' : 'non (générique)' });
    }
  }
  addTableSheet(
    workbook,
    'Sources des facteurs',
    [
      { header: 'Facteur', key: 'description', width: 45 },
      { header: 'Unité', key: 'unit', width: 9 },
      { header: 'Source', key: 'source', width: 90 },
      { header: 'Facteur national', key: 'isNational', width: 16 },
    ],
    [...factorSources.values()],
  );

  addTableSheet(
    workbook,
    'Procédés CBAM',
    [
      { header: 'Installation', key: 'installation', width: 26 },
      { header: 'Procédé', key: 'process', width: 24 },
      { header: 'Produit', key: 'product', width: 22 },
      { header: 'Code NC', key: 'cnCode', width: 12 },
      { header: 'Période', key: 'period', width: 24 },
      { header: 'Production (t)', key: 'production', width: 14, numFmt: '#,##0.###' },
      { header: 'Statut', key: 'status', width: 34 },
      { header: 'Directes (tCO2e)', key: 'direct', width: 16, numFmt: TCO2E_FORMAT },
      { header: 'Indirectes (tCO2e)', key: 'indirect', width: 16, numFmt: TCO2E_FORMAT },
      { header: 'Spécifiques directes (tCO2e/t)', key: 'seeDirect', width: 18, numFmt: '0.000000' },
      { header: 'Spécifiques indirectes (tCO2e/t)', key: 'seeIndirect', width: 18, numFmt: '0.000000' },
      { header: 'Éléments manquants / non pris en charge', key: 'gaps', width: 90 },
    ],
    processRows(await listProcesses(companyId)),
  );

  return { filename: `donnees-preparation-cbam-${today}.xlsx`, buffer: await workbookToBuffer(workbook) };
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
    : `<span class="status-tag" data-status="non_calcule">${count} à reprendre</span>`;
  const detail = count > 0
    ? `${count} ligne(s) avec anomalie signalée au contrôle interne`
    : 'Aucune anomalie signalée au contrôle interne';
  return `<tr><td>Contrôle interne</td><td>${tag}</td><td>${escapeCell(detail)}</td></tr>`;
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
      : 'Données de base réunies pour les lignes saisies — contrôle interne recommandé avant transmission.';

  const summaryHtml = `
    <h2>Résumé exécutif</h2>
    <div class="kpi-grid">
      <div class="kpi-tile"><div class="kpi-label">Entreprise</div><div class="kpi-value">${escapeCell(company.name)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Secteur</div><div class="kpi-value">${escapeCell(sectorLabel(company.sector))}</div></div>
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
            <td>${escapeCell(e.siteName ?? '—')}</td>
            <td class="mono">${escapeCell(e.periodStart)} → ${escapeCell(e.periodEnd)}</td>
            <td>${e.kind === 'energie' ? 'Énergie (calculé)' : 'Matière première (traçabilité)'}</td>
            <td>${escapeCell(e.description)}</td>
            <td class="mono">${escapeCell(e.quantity)}${e.unit ? ` ${escapeCell(e.unit)}` : ''}</td>
            <td>${escapeCell(e.factorSource ?? '—')}</td>
            <td class="mono">${formatTco2eCell(e.tco2e)}</td>
            <td><span class="status-tag" data-status="${escapeCell(e.status)}">${escapeCell(formatStatusLabel(e.status, { needsVerification: e.needsVerification }))}</span></td>
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

  const processes = processRows(await listProcesses(companyId));
  const processesHtml = processes.length === 0
    ? '<p>Aucun procédé renseigné.</p>'
    : `<table>
        <thead><tr><th>Installation / procédé</th><th>Produit (NC)</th><th>Production</th><th>Statut</th><th>Spécifiques directes</th><th>Spécifiques indirectes</th></tr></thead>
        <tbody>${processes.map((r) => `
          <tr>
            <td>${escapeCell(r.installation)} — ${escapeCell(r.process)}<br><span class="mono">${escapeCell(r.period)}</span></td>
            <td>${escapeCell(r.product)} (<span class="mono">${escapeCell(r.cnCode)}</span>)</td>
            <td class="mono">${r.production === null ? 'Non renseignée' : `${formatTco2e(r.production)} t`}</td>
            <td>${escapeCell(r.status)}${r.gaps ? `<br><span style="font-size:9px;">${escapeCell(r.gaps)}</span>` : ''}</td>
            <td class="mono">${r.seeDirect === null ? 'Non calculé' : `${formatTco2e(r.seeDirect, { maximumFractionDigits: 6 })} tCO2e/t`}</td>
            <td class="mono">${r.seeIndirect === null ? 'Non calculé' : `${formatTco2e(r.seeIndirect, { maximumFractionDigits: 6 })} tCO2e/t`}</td>
          </tr>`).join('')}</tbody>
      </table>`;

  const bodyHtml = `
    ${summaryHtml}
    <p>${CBAM_FRAMING_NOTE}</p>
    <div class="callout">${CBAM_NOT_OFFICIAL_NOTE}</div>
    <div class="callout">${CBAM_METHODOLOGY_NOTE}</div>
    ${checklistHtml}
    <h2>Données par produit</h2>
    ${groupsHtml || '<p>Aucune donnée à exporter pour le moment.</p>'}
    <h2>Procédés — émissions intrinsèques</h2>
    <div class="callout">${escapeCell(CBAM_PROCESS_NOTE)}</div>
    ${processesHtml}
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
