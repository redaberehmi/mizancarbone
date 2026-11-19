// ============================================================
// Import reproductible du classeur FM6E dans le registre des facteurs.
//
//   node src/db/import/fm6e-import.js --file "<chemin du .xlsx>"           -> aperçu (rien n'est écrit)
//   node src/db/import/fm6e-import.js --file "<chemin du .xlsx>" --apply   -> application
//
// Idempotent : une ligne déjà présente (même factor_uid, même début de
// validité) et de même valeur est laissée telle quelle ; une valeur
// différente pour le même identifiant n'écrase JAMAIS l'existant (rejet,
// une nouvelle version du fichier doit être importée sous son propre
// identifiant de version). Le classeur lui-même n'est jamais copié dans le
// dépôt Git (voir data/sources/README.md).
// ============================================================
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import {
  parseFm6eWorkbook,
  FM6E_SOURCE_FILE,
  FM6E_VERSION,
  FM6E_PUBLICATION,
  FM6E_APPLICATION_START,
} from './fm6e-registry.js';

const VALUE_TOLERANCE = 1e-9;

export function readWorkbook(buffer) {
  return XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellNF: false, cellStyles: false });
}

export async function applyFm6eImport(client, parsed, { fileSha256, mode, integrationDate }) {
  const accepted = [];
  const unchanged = [];
  const rejected = [...parsed.rejected];

  for (const f of parsed.accepted) {
    const existing = await client.query(
      'SELECT id, value_kgco2e FROM emission_factors WHERE factor_uid = $1 AND valid_from = $2',
      [f.factorUid, FM6E_APPLICATION_START],
    );
    if (existing.rows.length > 0) {
      if (Math.abs(Number(existing.rows[0].value_kgco2e) - f.value) <= VALUE_TOLERANCE + 1e-6 * Math.abs(f.value)) {
        unchanged.push(f);
      } else {
        rejected.push({
          sheet: f.sourceSheet,
          cell: f.sourceCell,
          label: f.activityLabel,
          reason: `Valeur différente (${f.value}) de celle déjà enregistrée (${existing.rows[0].value_kgco2e}) pour le même identifiant : l'existant n'est pas écrasé.`,
        });
      }
      continue;
    }
    accepted.push(f);
  }

  const report = {
    sourceFile: FM6E_SOURCE_FILE,
    version: FM6E_VERSION,
    fileSha256,
    accepted: accepted.map(summary),
    unchanged: unchanged.map(summary),
    rejected,
    notImportedSheets: parsed.notImportedSheets,
    gridFactor: parsed.gridFactor,
  };

  if (mode !== 'applique') return { report, batchId: null };

  const batch = await client.query(
    `INSERT INTO factor_import_batches (source_file, file_sha256, source_version, mode, accepted_count, rejected_count, unchanged_count, report)
     VALUES ($1, $2, $3, 'applique', $4, $5, $6, $7) RETURNING id`,
    [FM6E_SOURCE_FILE, fileSha256, FM6E_VERSION, accepted.length, rejected.length, unchanged.length, report],
  );
  const batchId = batch.rows[0].id;

  for (const f of accepted) {
    await client.query(
      `INSERT INTO emission_factors
         (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from,
          factor_uid, version_label, activity_label, gases_covered, gwp_reference, geography, represented_year,
          publication_date, integration_date, boundary, source_original, source_file, source_sheet, source_cell,
          uncertainty_pct, usage_restrictions, validity_note, methodological_status, rights_status, scope3_category, import_batch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,'MA',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
      [
        f.code,
        f.label,
        f.scope,
        f.category,
        f.unit,
        f.value,
        `Outil BEGES Maroc (FM6E), ${f.sourceSheet}!${f.sourceCell}, version draft du 15/10/2024 — source citée : ${f.sourceOriginal} — réutilisation commerciale à confirmer`.slice(0, 255),
        FM6E_APPLICATION_START,
        f.factorUid,
        FM6E_VERSION,
        f.activityLabel,
        'Non décomposé (CO2e total)',
        f.gwpReference,
        'Maroc (selon libellé ; « Monde », « importé » ou bilan d’un producteur le cas échéant)',
        f.representedYear ?? 'Non indiquée dans le classeur',
        FM6E_PUBLICATION,
        integrationDate,
        f.boundary,
        f.sourceOriginal,
        FM6E_SOURCE_FILE,
        f.sourceSheet,
        f.formula ? `${f.sourceCell} (formule : ${f.formula})`.slice(0, 160) : f.sourceCell,
        f.uncertaintyPct,
        [f.usageRestrictions, f.uncertaintyAnomaly ? `Incertitude du classeur ${f.uncertaintyAnomaly}.` : null].filter(Boolean).join(' ') || null,
        f.validityNote,
        f.methodologicalStatus,
        f.rightsStatus,
        f.scope3Category,
        batchId,
      ],
    );
  }

  for (const r of rejected) {
    await client.query(
      'INSERT INTO factor_import_rejections (batch_id, sheet, cell, label, reason) VALUES ($1, $2, $3, $4, $5)',
      [batchId, r.sheet, r.cell, r.label, r.reason],
    );
  }

  return { report, batchId };
}

function summary(f) {
  return {
    code: f.code,
    label: f.activityLabel,
    value: f.value,
    unit: f.unit,
    scope: f.scope,
    category: f.category,
    boundary: f.boundary,
    cell: `${f.sourceSheet}!${f.sourceCell}`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx === -1 || !args[fileIdx + 1]) {
    console.error('Usage : node src/db/import/fm6e-import.js --file "<chemin du classeur>" [--apply]');
    process.exit(1);
  }
  const filePath = args[fileIdx + 1];
  const mode = args.includes('--apply') ? 'applique' : 'apercu';
  const buffer = readFileSync(filePath);
  const fileSha256 = createHash('sha256').update(buffer).digest('hex');
  const parsed = parseFm6eWorkbook(readWorkbook(buffer));

  const { pool } = await import('../../config/db.js');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { report, batchId } = await applyFm6eImport(client, parsed, {
      fileSha256,
      mode,
      integrationDate: new Date().toISOString().slice(0, 10),
    });
    await client.query(mode === 'applique' ? 'COMMIT' : 'ROLLBACK');

    const reportPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data/sources/fm6e-import-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Mode : ${mode}${batchId ? ` (lot n° ${batchId})` : ' — rien n’a été écrit en base'}`);
    console.log(`Retenus (nouveaux) : ${report.accepted.length} · inchangés : ${report.unchanged.length} · écartés : ${report.rejected.length}`);
    console.log(`Rapport détaillé : ${reportPath}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('Échec de l’import :', err);
    process.exit(1);
  });
}
