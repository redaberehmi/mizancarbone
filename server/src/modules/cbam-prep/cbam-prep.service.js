import { pool } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { renderBrandedHtml, htmlToPdfBuffer } from '../reports/pdf-template.js';
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
    return {
      id: row.id,
      kind: isRawMaterial ? 'matiere_premiere' : 'energie',
      product: row.product_allocation,
      siteId: row.site_id,
      siteName: row.site_name,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      description: isRawMaterial ? row.material_label : row.factor_label,
      quantity: Number(row.quantity),
      unit: isRawMaterial ? null : row.factor_unit,
      supplier: row.supplier,
      sourceDocument: row.source_document,
      tco2e: isRawMaterial ? null : row.tco2e !== null ? Number(row.tco2e) : null,
      isNational: isRawMaterial ? null : row.is_national,
      factorSource: isRawMaterial ? null : row.factor_source,
      verificationStatus: row.verification_status,
    };
  });
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

  return {
    methodologyNote: CBAM_METHODOLOGY_NOTE,
    groups: [...groups.values()],
    entries,
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

export async function buildPdfExport(companyId) {
  const company = await getCompany(companyId);
  const { groups } = await getPreparationSummary(companyId);

  const groupsHtml = groups
    .map((g) => {
      const rows = g.entries
        .map((e) => `
          <tr>
            <td>${e.siteName ?? '—'}</td>
            <td class="mono">${e.periodStart} → ${e.periodEnd}</td>
            <td>${e.kind === 'energie' ? 'Énergie' : 'Matière première'}</td>
            <td>${escapeCell(e.description)}</td>
            <td class="mono">${e.quantity}${e.unit ? ` ${e.unit}` : ''}</td>
            <td class="mono">${e.tco2e === null ? 'n.c.' : e.tco2e.toFixed(3)}</td>
          </tr>`)
        .join('');
      return `
        <h2>${escapeCell(g.product ?? 'Non alloué')}</h2>
        <p class="mono">Total énergie calculé : ${g.energieTco2eTotal.toFixed(3)} tCO2e · ${g.matierePremiereCount} ligne(s) matière première (traçabilité)</p>
        <table>
          <thead><tr><th>Site</th><th>Période</th><th>Nature</th><th>Description</th><th>Quantité</th><th>tCO2e</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join('');

  const bodyHtml = `
    <p>${CBAM_FRAMING_NOTE}</p>
    <div class="callout">${CBAM_METHODOLOGY_NOTE}</div>
    ${groupsHtml || '<p>Aucune donnée à exporter pour le moment.</p>'}
  `;

  const html = renderBrandedHtml({
    title: 'Données de préparation CBAM',
    companyName: company.name,
    generatedAtLabel: new Date().toLocaleDateString('fr-FR'),
    bodyHtml,
  });

  const buffer = await htmlToPdfBuffer(html);
  return { filename: `donnees-preparation-cbam-${new Date().toISOString().slice(0, 10)}.pdf`, buffer };
}

function escapeCell(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
