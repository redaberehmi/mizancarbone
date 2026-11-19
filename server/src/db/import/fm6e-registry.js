// ============================================================
// Lecture et classement du classeur FM6E « Bilan Carbone Maroc-compatible
// postes iso14064 et GHG Protocol — draft 15 octobre 2024 ».
//
// Ce module ne touche pas la base : il transforme le classeur en deux
// listes (facteurs retenus / lignes écartées avec leur raison). L'écriture
// en base est faite par fm6e-import.js, en mode aperçu ou application.
//
// Règles de classement (décisions documentées, aucune valeur inventée) :
//  - un facteur « amont et combustion » non décomposé est ÉCARTÉ pour le
//    Scope 1 : le classeur ne fournit pas la part combustion seule, et
//    aucune répartition n'est fabriquée ;
//  - un facteur dont le périmètre n'est pas indiqué n'est pas utilisé pour
//    le Scope 1 ;
//  - les facteurs d'électricité de production (ACV, France 2016) ne sont pas
//    admissibles comme taux d'émission direct d'un instrument contractuel ;
//  - une ligne sans source, avec une source « estimé », ou à formule
//    paramétrique non prise en charge, est écartée ;
//  - la valeur lue est toujours la valeur de la cellule (valeur calculée en
//    cache pour une formule), la formule étant conservée pour traçabilité.
// ============================================================

export const FM6E_SOURCE_FILE =
  'Bilan Carbone Maroc-compatible postes iso14064 et GHG Protocol-draft-15 octobre 2024.xlsx';
export const FM6E_VERSION = 'draft-2024-10-15';
export const FM6E_PUBLICATION = 'Version « draft » du 15/10/2024 (nom du fichier) — aucune version plus récente connue';
// Période d'utilisation retenue dans MizanCarbone (choix d'application,
// distinct de l'année représentée par chaque facteur, non indiquée dans le
// classeur pour la plupart des lignes).
export const FM6E_APPLICATION_START = '2024-01-01';

const RIGHTS = 'a_confirmer';

const TABLES = [
  { code: 'p1', sheet: 'P1-S1-Source Fixe combustion', from: 41, to: 75, src: 'M', unc: 'E', kind: 'combustion_fixe' },
  { code: 'p2', sheet: 'P2-S1-Source mobile Combust.', from: 38, to: 50, src: 'M', unc: 'E', kind: 'combustion_mobile' },
  { code: 'p3', sheet: 'P3-S1-Emiss. Proc. hors énergie', from: 42, to: 62, src: 'M', unc: 'E', kind: 'procede' },
  { code: 'p4', sheet: 'P4-S1-Emiss. fugitives Climatis', from: 88, to: 186, src: 'M', unc: 'E', kind: 'fugitive' },
  { code: 'p6c', sheet: 'P6-S2-ConsommationElectricité', from: 49, to: 50, src: 'M', unc: 'L', kind: 'electricite_reseau' },
  { code: 'p6p', sheet: 'P6-S2-ConsommationElectricité', from: 56, to: 63, src: 'M', unc: 'L', kind: 'electricite_production' },
  { code: 'p9i', sheet: 'P9-S3-.Achats prod. et services', from: 59, to: 116, src: 'M', unc: 'E', kind: 'achat' },
  { code: 'p9s', sheet: 'P9-S3-.Achats prod. et services', from: 125, to: 137, src: 'M', unc: 'E', kind: 'achat' },
  { code: 'p10', sheet: 'P10-S3.Immobilisations de biens', from: 44, to: 98, src: 'F', unc: 'E', kind: 'immobilisation' },
  { code: 'p11', sheet: 'P11-S3- Déchets', from: 40, to: 55, src: 'M', unc: 'E', kind: 'dechets' },
  { code: 'p17r', sheet: 'P17-S3-Transport march.aval', from: 93, to: 117, src: 'F', unc: 'E', kind: 'fret' },
  { code: 'p17v', sheet: 'P17-S3-Transport march.aval', from: 125, to: 149, src: 'F', unc: 'E', kind: 'fret' },
  { code: 'p17f', sheet: 'P17-S3-Transport march.aval', from: 156, to: 160, src: 'F', unc: 'E', kind: 'fret' },
  { code: 'p17a', sheet: 'P17-S3-Transport march.aval', from: 166, to: 181, src: 'F', unc: 'E', kind: 'fret' },
  { code: 'p17m', sheet: 'P17-S3-Transport march.aval', from: 190, to: 195, src: 'F', unc: 'E', kind: 'fret' },
];

// Feuilles volontairement non importées, avec la raison affichée au rapport.
export const NOT_IMPORTED_SHEETS = [
  { sheet: 'P5-S1-UTCATF', reason: "Poste UTCATF non pris en charge par MizanCarbone ; la feuille référence en outre un classeur externe manquant." },
  { sheet: 'P7-S2-Emiss. Vap. Chal. Froid', reason: 'Formules du tableau de saisie cassées (#REF!) ; vapeur/chaleur/froid achetés non pris en charge à ce stade.' },
  { sheet: 'P8-S3-En. non incluse post-1&7', reason: 'Formules cassées (#REF!) et facteurs recopiés de P7.' },
  { sheet: 'P12-S3-Trans.March.amont', reason: 'Copie de la feuille P17 (mêmes facteurs) : importée une seule fois via P17, catégorie amont/aval choisie à la saisie.' },
  { sheet: 'P13-S3-Transp. Professionnels', reason: 'Transport de personnes non pris en charge à ce stade.' },
  { sheet: 'P16-S3-Trans.Client.Visit', reason: 'Transport de personnes non pris en charge à ce stade.' },
  { sheet: 'P22-S3-Trajet dom.Travail.Empl.', reason: 'Transport de personnes non pris en charge à ce stade.' },
  { sheet: 'P14 / P15 / P18 / P19 / P20 / P21 / P23', reason: 'Feuilles sans facteur d’émission renseigné.' },
];

function cellValue(ws, address) {
  const cell = ws?.[address];
  if (!cell) return { value: null, formula: null };
  return { value: cell.v ?? null, formula: cell.f ?? null };
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

// « kgCO2e/Tonne » -> « tonne » ; « kgCO2e / (tonne.km) » -> « tonne.km ».
export function normalizeUnit(raw) {
  const t = text(raw);
  if (t === '%') return '%';
  const match = t.match(/kg\s*CO2e?\s*\/\s*\(?\s*([^)]*?)\s*\)?\s*$/i);
  if (!match) return null;
  const unit = match[1].trim();
  if (/^tonnes?$/i.test(unit) || /^t$/i.test(unit)) return 'tonne';
  if (/^litre$/i.test(unit)) return 'L';
  return unit;
}

function uncertaintyPct(raw) {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return { pct: null, anomaly: raw === null || raw === '' ? null : text(raw) };
  // Échelle du classeur : fraction (0,1 = 10 %). Une valeur > 2 (ex. 45,3)
  // est hors échelle (anomalie documentée pour les céréales importées).
  if (raw > 2) return { pct: null, anomaly: `valeur hors échelle (${raw})` };
  return { pct: Math.round(raw * 10000) / 100, anomaly: null };
}

function factorCode(tableCode, row) {
  return `fm6e_${tableCode}_r${row}`;
}

function uid(sheet, address) {
  return `FM6E-BEGES/${FM6E_VERSION}/${sheet}!${address}`;
}

function buildValidityIndex(workbook) {
  const ws = workbook.Sheets['Validité facteurs émission'];
  const index = new Map();
  if (!ws) return index;
  for (let r = 2; r <= 200; r += 1) {
    const label = text(cellValue(ws, `B${r}`).value).toLowerCase();
    if (!label) continue;
    const validity = text(cellValue(ws, `C${r}`).value);
    const updater = text(cellValue(ws, `D${r}`).value);
    const validator = text(cellValue(ws, `E${r}`).value);
    index.set(label, `Validité : ${validity || 'non indiquée'} ; actualisation : ${updater || 'non indiquée'} ; validation : ${validator || 'non indiquée'} (feuille « Validité facteurs émission », ligne ${r})`);
  }
  return index;
}

const BIOMASS = /(bois|charbon de bois|grignon|sciure|granul)/i;

// Retourne { accept: {...} } ou { reject: 'raison' }.
function classify(table, row) {
  const { label, unit, source, value, formula } = row;
  const sourceLower = source.toLowerCase();
  const labelLower = label.toLowerCase();

  if (table.kind === 'combustion_fixe' || table.kind === 'combustion_mobile') {
    if (/hydrog/i.test(label)) {
      return { reject: "Facteur de production/transport d'hydrogène (amont), pas une combustion ; les facteurs de production d'hydrogène sont repris depuis la feuille Achats (P9)." };
    }
    if (/amont/i.test(label) || /amont/i.test(source)) {
      return {
        reject:
          "Facteur « combustion + amont » non décomposé : inutilisable pour le Scope 1. Le classeur ne fournit pas la part combustion seule ; aucune répartition n'est fabriquée. La part amont relèverait du Scope 3 (cat. 3).",
      };
    }
    if (!/combustion/i.test(label)) {
      return {
        reject:
          "Périmètre non indiqué (combustion seule ou combustion + amont) : non utilisable pour le Scope 1 tant que la source ne le précise pas.",
      };
    }
    return {
      accept: {
        scope: 1,
        category: table.kind,
        boundary: 'combustion',
        biogenic: BIOMASS.test(label),
        methodologicalStatus: 'a_confirmer',
        usageRestrictions: `Combustion seule selon le libellé du classeur (« ${label} »). Valeur « Monde » le cas échéant : représentativité marocaine non établie.`,
      },
    };
  }

  if (table.kind === 'procede') {
    const isGwpCoded = formula && /\*\s*(28|265)\b/.test(formula);
    return {
      accept: {
        scope: 1,
        category: 'procede',
        boundary: 'procede',
        methodologicalStatus: 'a_confirmer',
        gwpReference: isGwpCoded
          ? `PRG codé dans la cellule (${formula}) : valeurs AR5 (28 / 265), alors que la feuille « Incertitude et PRG » retient l'AR6 (27,9 / 273)`
          : 'Non précisé (titre de colonne : AR6)',
        usageRestrictions: "Émission de procédé hors combustion. L'unité d'activité doit correspondre exactement à celle du facteur.",
      },
    };
  }

  if (table.kind === 'fugitive') {
    return {
      accept: {
        scope: 1,
        category: 'fugitive',
        boundary: 'fugitive',
        methodologicalStatus: 'a_confirmer',
        gwpReference:
          "Titre du tableau : « PRG AR5 », mais les valeurs CH4 (27,9) et N2O (273) correspondent à l'AR6 — référence à confirmer",
        usageRestrictions:
          'Multiplier la MASSE DE FLUIDE ÉMISE (fuite, estimée par la quantité rechargée) par ce PRG. Ne jamais utiliser la charge totale de l’équipement comme émission annuelle.',
      },
    };
  }

  if (table.kind === 'electricite_reseau') {
    if (/perte/i.test(label)) return { derivedLosses: true };
    if (/mix moyen/i.test(label)) return { existingGridFactor: true };
    return { reject: 'Ligne électricité non reconnue.' };
  }

  if (table.kind === 'electricite_production') {
    return {
      reject:
        "Facteur d'analyse de cycle de vie (construction incluse) issu d'une étude française de 2016 : non admissible comme taux d'émission direct d'un instrument contractuel (GHG Protocol Scope 2, tableau 6.3 : facteurs « combustion seule »).",
    };
  }

  if (!source) return { reject: 'Source non renseignée dans le classeur (et incertitude hors échelle) : provenance non traçable.' };
  if (/^estim/i.test(sourceLower)) return { reject: 'Valeur indiquée « estimé » sans source primaire.' };

  if (table.kind === 'achat') {
    const monetary = /kmad/i.test(unit);
    const restrictions = [];
    if (monetary) {
      restrictions.push(
        `Ratio monétaire réservé à la typologie « ${label} ». Ne pas l'appliquer automatiquement aux assurances ni à l'ensemble des achats : choix et justification obligatoires à la saisie.`,
      );
    }
    if (/lydec/i.test(labelLower)) restrictions.push('Spécifique au réseau LYDEC (Casablanca), bilan 2015.');
    if (/maghreb steel|multicerame|bati chaouia/i.test(source)) restrictions.push(`Basé sur le bilan d'un producteur (${source}) : représentativité à vérifier pour d'autres fournisseurs.`);
    return {
      accept: {
        scope: 3,
        scope3Category: 1,
        category: monetary ? 'scope3_achat_monetaire' : 'scope3_achat_physique',
        boundary: monetary ? 'monetaire' : 'non_precise',
        methodologicalStatus: 'a_confirmer',
        usageRestrictions: restrictions.join(' ') || null,
      },
    };
  }

  if (table.kind === 'immobilisation') {
    const monetary = /kmad/i.test(unit);
    return {
      accept: {
        scope: 3,
        scope3Category: 2,
        category: monetary ? 'scope3_achat_monetaire' : 'scope3_immobilisation',
        boundary: monetary ? 'monetaire' : 'non_precise',
        methodologicalStatus: 'a_confirmer',
        usageRestrictions:
          "Biens d'équipement : MizanCarbone comptabilise l'émission l'année d'acquisition (GHG Protocol, catégorie 2), sans l'amortissement sur la durée de vie appliqué par le classeur.",
      },
    };
  }

  if (table.kind === 'dechets') {
    if (formula && /O\d+/.test(formula)) {
      return { reject: `Facteur paramétrique (formule ${formula}, dépend d'une population ou d'une capacité saisie) : non pris en charge.` };
    }
    return {
      accept: {
        scope: 3,
        scope3Category: 5,
        category: 'scope3_dechets',
        boundary: 'fin_de_vie',
        methodologicalStatus: 'a_confirmer',
        usageRestrictions: 'Saisir la masse de déchets générés pour le mode de traitement correspondant au libellé.',
      },
    };
  }

  if (table.kind === 'fret') {
    return {
      accept: {
        scope: 3,
        scope3Category: null,
        category: 'scope3_fret',
        boundary: /amont et combustion/i.test(label) ? 'transport_amont_combustion' : 'non_precise',
        methodologicalStatus: 'a_confirmer',
        usageRestrictions: /ferroviaire/i.test(label)
          ? 'Les facteurs train diesel et train électrique ont la même valeur dans le classeur : différenciation à confirmer.'
          : 'Catégorie 4 (fret amont payé par l’entreprise) ou 9 (aval) à choisir à la saisie.',
      },
    };
  }

  return { reject: 'Type de tableau non pris en charge.' };
}

export function parseFm6eWorkbook(workbook) {
  const validity = buildValidityIndex(workbook);
  const accepted = [];
  const rejected = [];
  const seen = new Map();
  let gridFactor = null;
  let lossRow = null;

  for (const table of TABLES) {
    const ws = workbook.Sheets[table.sheet];
    if (!ws) {
      rejected.push({ sheet: table.sheet, cell: '-', label: null, reason: 'Feuille absente du classeur.' });
      continue;
    }
    for (let r = table.from; r <= table.to; r += 1) {
      const label = text(cellValue(ws, `B${r}`).value);
      let { value } = cellValue(ws, `C${r}`);
      const { formula } = cellValue(ws, `C${r}`);
      const unitRaw = cellValue(ws, `D${r}`).value;
      const source = text(cellValue(ws, `${table.src}${r}`).value);
      const unc = uncertaintyPct(cellValue(ws, `${table.unc}${r}`).value);
      if (!label && (value === null || value === '')) continue;

      const address = `C${r}`;
      if (!label) {
        rejected.push({ sheet: table.sheet, cell: address, label: null, reason: 'Valeur sans libellé.' });
        continue;
      }
      // Certaines cellules contiennent un nombre saisi comme TEXTE (ex. « 88 »
      // en P10) : accepté uniquement s'il s'agit d'un nombre décimal pur,
      // l'anomalie étant conservée au registre.
      let textNumberAnomaly = null;
      if (typeof value === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(value)) {
        textNumberAnomaly = `Valeur saisie comme texte dans le classeur (« ${value.trim()} »).`;
        value = Number(value.trim().replace(',', '.'));
      }
      if (typeof value !== 'number' || Number.isNaN(value)) {
        rejected.push({ sheet: table.sheet, cell: address, label, reason: `Valeur absente ou non numérique (${text(value) || 'vide'}).` });
        continue;
      }

      const row = { label, unit: text(unitRaw), source, value, formula };
      const decision = classify(table, row);

      if (decision.existingGridFactor) {
        gridFactor = { sheet: table.sheet, address, value, formula, uncertaintyPct: unc.pct };
        continue;
      }
      if (decision.derivedLosses) {
        lossRow = { sheet: table.sheet, address, value, uncertaintyPct: unc.pct };
        continue;
      }
      if (decision.reject) {
        rejected.push({ sheet: table.sheet, cell: address, label, reason: decision.reject });
        continue;
      }

      const unit = normalizeUnit(unitRaw);
      if (!unit) {
        rejected.push({ sheet: table.sheet, cell: address, label, reason: `Unité non interprétable (« ${text(unitRaw)} »).` });
        continue;
      }
      if (value < 0) {
        rejected.push({ sheet: table.sheet, cell: address, label, reason: 'Valeur négative.' });
        continue;
      }

      const dedupeKey = `${table.kind}|${label.toLowerCase()}|${unit.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        rejected.push({ sheet: table.sheet, cell: address, label, reason: `Doublon de ${seen.get(dedupeKey)} (même libellé et même unité).` });
        continue;
      }
      seen.set(dedupeKey, `${table.sheet}!${address}`);

      const a = decision.accept;
      accepted.push({
        code: factorCode(table.code, r),
        factorUid: uid(table.sheet, address),
        label: `${label} (FM6E)`.slice(0, 255),
        activityLabel: label,
        scope: a.scope,
        category: a.category,
        scope3Category: a.scope3Category ?? null,
        unit,
        value,
        formula,
        boundary: a.boundary,
        biogenic: a.biogenic ?? false,
        gwpReference: a.gwpReference ?? null,
        uncertaintyPct: unc.pct,
        uncertaintyAnomaly: unc.anomaly,
        sourceOriginal: source,
        sourceSheet: table.sheet,
        sourceCell: address,
        methodologicalStatus: a.methodologicalStatus,
        rightsStatus: RIGHTS,
        usageRestrictions: [a.usageRestrictions, textNumberAnomaly, a.biogenic ?'Combustible biomasse : le CO2 biogénique doit être rapporté séparément des scopes ; non décomposé ici.' : null]
          .filter(Boolean)
          .join(' ') || null,
        validityNote: validity.get(label.toLowerCase()) ?? null,
      });
    }
  }

  // Pertes en ligne : le classeur calcule (kWh + kWh × 12,2 %) × mix. Dans
  // MizanCarbone, la consommation × mix reste en Scope 2 et la part pertes
  // devient un facteur Scope 3 cat. 3 explicite = taux × mix, deux cellules
  // du même classeur (pas une hypothèse ajoutée).
  let derived = null;
  if (gridFactor && lossRow) {
    const rate = lossRow.value / 100;
    derived = {
      code: 'fm6e_electricity_ma_td_losses_kwh',
      factorUid: uid(lossRow.sheet, `${gridFactor.address}*${lossRow.address}`),
      label: 'Pertes en ligne du réseau national (part Scope 3 cat. 3, FM6E)',
      activityLabel: 'Pertes en ligne — électricité consommée',
      scope: 3,
      category: 'scope3_pertes_reseau',
      scope3Category: 3,
      unit: 'kWh',
      value: Math.round(rate * gridFactor.value * 1e6) / 1e6,
      formula: `${lossRow.address}% × ${gridFactor.address} (${lossRow.value} % × ${gridFactor.value})`,
      boundary: 'pertes_reseau',
      biogenic: false,
      gwpReference: null,
      uncertaintyPct: lossRow.uncertaintyPct,
      uncertaintyAnomaly: null,
      sourceOriginal: 'FM6E (taux de perte en ligne et mix moyen 2020)',
      sourceSheet: lossRow.sheet,
      sourceCell: `${gridFactor.address} × ${lossRow.address}`,
      methodologicalStatus: 'a_confirmer',
      rightsStatus: RIGHTS,
      usageRestrictions:
        "À appliquer aux kWh consommés depuis le réseau. Mix de l'année 2020, utilisé faute de donnée plus récente. Le classeur ajoute ces pertes au Scope 2 ; MizanCarbone les présente en Scope 3 cat. 3, conformément au GHG Protocol.",
      validityNote: validity.get('taux de perte en ligne') ?? null,
      representedYear: '2020',
    };
    accepted.push(derived);
  }

  return {
    accepted,
    rejected,
    gridFactor,
    notImportedSheets: NOT_IMPORTED_SHEETS,
  };
}
