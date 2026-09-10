import * as XLSX from 'xlsx';
import { fileTypeFromBuffer } from 'file-type';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { listAvailableFactors, siteIdsForCompany } from './activity-entries.service.js';
import { RAW_MATERIAL_FACTOR_CODE } from './constants.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const IMPORT_TEMPLATE_HEADERS = [
  'site',
  'type',
  'code_facteur',
  'description_matiere',
  'fournisseur',
  'periode_debut',
  'periode_fin',
  'quantite',
  'document_source',
];

function normalize(value) {
  return String(value ?? '').trim();
}

function addError(errors, line, field, message) {
  errors.push({ line, field, message });
}

// Valide le fichier entier avant toute insertion — soit tout est importé,
// soit rien ne l'est, avec un rapport d'erreurs ligne par ligne clair
// (exigence section 5, module 2 : "rapport d'erreurs clair si le fichier est
// mal formé").
export async function parseAndValidateImport(buffer, companyId) {
  let workbook;
  try {
    // raw:true est essentiel ici : sans lui, SheetJS devine le type des
    // cellules CSV et convertit silencieusement des chaînes comme
    // "2024-01-01" en numéro de série Excel (ex: 45292.04...), même pour un
    // simple fichier texte CSV. Avec raw:true, les valeurs restent du texte
    // brut, qu'on parse nous-mêmes (dates, nombres) dans la boucle ci-dessous.
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  } catch {
    return { rows: [], errors: [{ line: 0, field: 'fichier', message: 'Fichier illisible (CSV ou Excel attendu).' }] };
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], errors: [{ line: 0, field: 'fichier', message: 'Le fichier ne contient aucune feuille.' }] };
  }

  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '', raw: true });
  if (rawRows.length === 0) {
    return { rows: [], errors: [{ line: 0, field: 'fichier', message: 'Le fichier ne contient aucune ligne de données.' }] };
  }

  const [sites, factors] = await Promise.all([siteIdsForCompany(companyId), listAvailableFactors()]);
  const siteByName = new Map(sites.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const factorByCode = new Map(factors.map((f) => [f.code, f]));

  const errors = [];
  const validRows = [];

  rawRows.forEach((raw, index) => {
    const line = index + 2; // +1 pour l'index 0-based, +1 pour la ligne d'en-tête
    const site = normalize(raw.site);
    const type = normalize(raw.type).toLowerCase();
    const codeFacteur = normalize(raw.code_facteur);
    const descriptionMatiere = normalize(raw.description_matiere);
    const fournisseur = normalize(raw.fournisseur) || null;
    const periodeDebut = normalize(raw.periode_debut);
    const periodeFin = normalize(raw.periode_fin);
    const quantiteRaw = normalize(raw.quantite);
    const documentSource = normalize(raw.document_source) || null;

    let hasError = false;

    if (!site) {
      addError(errors, line, 'site', 'Champ obligatoire.');
      hasError = true;
    } else if (!siteByName.has(site.toLowerCase())) {
      addError(errors, line, 'site', `Site "${site}" inconnu pour votre entreprise.`);
      hasError = true;
    }

    if (type !== 'energie' && type !== 'matiere_premiere') {
      addError(errors, line, 'type', 'Doit valoir "energie" ou "matiere_premiere".');
      hasError = true;
    }

    if (type === 'energie') {
      if (!codeFacteur) {
        addError(errors, line, 'code_facteur', 'Obligatoire pour une ligne de type "energie".');
        hasError = true;
      } else if (!factorByCode.has(codeFacteur)) {
        addError(errors, line, 'code_facteur', `Code facteur "${codeFacteur}" inconnu.`);
        hasError = true;
      }
    }

    if (type === 'matiere_premiere' && !descriptionMatiere) {
      addError(errors, line, 'description_matiere', 'Obligatoire pour une ligne de type "matiere_premiere".');
      hasError = true;
    }

    if (!DATE_RE.test(periodeDebut)) {
      addError(errors, line, 'periode_debut', 'Format attendu AAAA-MM-JJ.');
      hasError = true;
    }
    if (!DATE_RE.test(periodeFin)) {
      addError(errors, line, 'periode_fin', 'Format attendu AAAA-MM-JJ.');
      hasError = true;
    }
    if (DATE_RE.test(periodeDebut) && DATE_RE.test(periodeFin) && periodeFin < periodeDebut) {
      addError(errors, line, 'periode_fin', 'Doit être postérieure ou égale à periode_debut.');
      hasError = true;
    }

    const quantity = Number(quantiteRaw.replace(',', '.'));
    if (!quantiteRaw || Number.isNaN(quantity) || quantity <= 0) {
      addError(errors, line, 'quantite', 'Doit être un nombre positif.');
      hasError = true;
    }

    if (hasError) return;

    validRows.push({
      siteId: siteByName.get(site.toLowerCase()),
      type,
      factorCode: type === 'energie' ? codeFacteur : RAW_MATERIAL_FACTOR_CODE,
      materialLabel: type === 'matiere_premiere' ? descriptionMatiere : null,
      supplier: type === 'matiere_premiere' ? fournisseur : null,
      periodStart: periodeDebut,
      periodEnd: periodeFin,
      quantity,
      sourceDocument: documentSource,
    });
  });

  return { rows: validRows, errors };
}

export async function insertImportedRows(companyId, userId, rows, defaultSourceDocument) {
  return withTransaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `INSERT INTO activity_entries
           (company_id, site_id, period_start, period_end, factor_code, quantity,
            material_label, supplier, source_document, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          companyId,
          row.siteId,
          row.periodStart,
          row.periodEnd,
          row.factorCode,
          row.quantity,
          row.materialLabel,
          row.supplier,
          row.sourceDocument ?? defaultSourceDocument,
          userId,
        ],
      );
    }
    return rows.length;
  });
}

const ALLOWED_SNIFFED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
]);

// Vérifie le type réel du fichier par ses octets (magic bytes), jamais par
// la seule extension ou le Content-Type déclaré par le client — les deux
// sont librement falsifiables (exigence section 7.9).
//
// Un .xlsx a une signature détectable (conteneur zip). Un .csv n'en a aucune
// (texte brut) : file-type renverra alors `undefined`, ce qui est attendu.
// Dans ce cas on accepte uniquement si (a) le nom de fichier se termine par
// .csv ET (b) le contenu est bien du texte (pas un binaire déguisé en .csv
// que file-type aurait autrement identifié).
export async function assertImportFile(file) {
  if (!file) {
    throw new AppError(400, 'Aucun fichier reçu.');
  }

  // file-type lève une exception (au lieu de renvoyer undefined) sur un
  // buffer trop court pour ses détecteurs internes (ex: un petit fichier
  // binaire tronqué) — on traite ça comme "type non identifié", pas comme
  // une erreur serveur.
  let sniffed;
  try {
    sniffed = await fileTypeFromBuffer(file.buffer);
  } catch {
    sniffed = undefined;
  }

  if (sniffed) {
    if (!ALLOWED_SNIFFED_MIME_TYPES.has(sniffed.mime)) {
      throw new AppError(400, `Type de fichier non supporté (détecté : ${sniffed.mime}). Utilisez un fichier CSV ou Excel (.xlsx).`);
    }
    return;
  }

  const looksLikeCsvName = /\.csv$/i.test(file.originalname || '');
  const looksLikeText = isLikelyPlainText(file.buffer);
  if (!looksLikeCsvName || !looksLikeText) {
    throw new AppError(400, 'Type de fichier non reconnu. Utilisez un fichier CSV (.csv) ou Excel (.xlsx).');
  }
}

function isLikelyPlainText(buffer) {
  const sample = buffer.subarray(0, 2048);
  let suspiciousBytes = 0;
  for (const byte of sample) {
    // Octets nuls ou codes de contrôle (hors tabulation/retour à la ligne)
    // typiques d'un binaire, absents d'un CSV texte légitime.
    if (byte === 0 || (byte < 9) || (byte > 13 && byte < 32)) {
      suspiciousBytes += 1;
    }
  }
  return suspiciousBytes === 0;
}
