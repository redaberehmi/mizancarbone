// ============================================================
// Vocabulaire de statut partagé entre les deux rapports PDF (Bilan Carbone
// et Préparation CBAM) — décision explicite : une même donnée source ne
// doit jamais s'afficher avec un statut différent selon le rapport qui la
// montre. Ajouté suite à une demande de cadrage : le statut affiché ne doit
// JAMAIS être déduit uniquement d'un flag technique "HasData" (une entrée
// peut exister sans avoir pu être calculée, ce qui est différent de
// "aucune entrée du tout").
//
//   manquant    : aucune entrée saisie du tout pour ce poste
//   non_calcule : une ou plusieurs entrées existent mais le calcul n'a pas
//                 pu être fait (facteur manquant pour la période) OU la
//                 ligne est structurellement hors calcul par choix produit
//                 (matière première : Scope 3 estimé globalement, jamais
//                 ligne par ligne — voir CBAM_METHODOLOGY_NOTE)
//   estime      : calculé, mais par une méthode d'estimation (Scope 3
//                 spend-based) — jamais présenté avec la même confiance
//                 qu'un calcul direct Scope 1/2
//   zero_reel   : calculé, méthode directe, résultat réellement nul
//   reel        : calculé, méthode directe, résultat positif
//
// "à vérifier" n'est PAS un statut concurrent de ceux ci-dessus : c'est une
// annotation orthogonale (needsVerification), portée par le champ réel
// emission_results.verification_status = 'partiellement_verifie'. Le
// confondre avec le statut de base aurait deux effets indésirables :
//   - marquer 100% des lignes "à vérifier" par défaut (verification_status
//     vaut 'non_verifie' pour toute donnée V1, ce workflow n'étant pas
//     encore éditable — Module 8, V1.5) : bruyant et sans valeur informative
//   - perdre l'information de statut de base (estimé/réel/non calculé)
//     qu'un simple remplacement écraserait
// ============================================================

export const STATUS_LABELS = {
  manquant: 'Manquant',
  non_calcule: 'Non calculé',
  estime: 'Estimé',
  zero_reel: '0 réel',
  reel: 'Réel',
};

// annotations : { needsVerification, incomplete } — deux drapeaux
// orthogonaux au statut de base, jamais fusionnés dans le statut lui-même
// (un agrégat peut très bien être "reel" ET incomplet en même temps : voir
// hasUncalculatedEntries ci-dessous).
export function formatStatusLabel(status, annotations = {}) {
  const { needsVerification = false, incomplete = false } = annotations;
  let label = STATUS_LABELS[status] ?? status;
  if (incomplete) label += ' · données incomplètes';
  if (needsVerification) label += ' · à vérifier';
  return label;
}

// Statut d'un agrégat (ex. un scope entier) à partir de compteurs réels —
// jamais d'un simple booléen "a des données". entryCount inclut les entrées
// non calculées ; calculatedCount ne compte que celles avec un résultat.
//
// hasUncalculatedEntries couvre un cas trouvé en vérification visuelle du
// PDF réel (pas par les tests unitaires) : un scope avec PLUSIEURS entrées,
// dont certaines calculées et d'autres non, obtenait le statut "reel" tout
// court — le total affiché semblait complet alors qu'une partie des données
// saisies manquait à l'appel, silencieusement. calculatedCount === 0 ne
// couvre que le cas "rien n'est calculé" ; ce nouveau drapeau couvre le cas
// intermédiaire "une partie seulement est calculée", qui doit rester visible
// même quand le statut de base reste "reel"/"zero_reel"/"estime".
export function determineAggregateStatus({
  entryCount,
  calculatedCount,
  sumTco2e,
  isEstimation = false,
  hasPartiallyVerified = false,
}) {
  const hasUncalculatedEntries = entryCount > calculatedCount;

  if (entryCount === 0) {
    return { status: 'manquant', needsVerification: false, hasUncalculatedEntries: false };
  }
  if (calculatedCount === 0) {
    return { status: 'non_calcule', needsVerification: false, hasUncalculatedEntries: true };
  }
  if (isEstimation) {
    return { status: 'estime', needsVerification: hasPartiallyVerified, hasUncalculatedEntries };
  }
  return {
    status: Number(sumTco2e) === 0 ? 'zero_reel' : 'reel',
    needsVerification: hasPartiallyVerified,
    hasUncalculatedEntries,
  };
}

// Statut d'une ligne individuelle (activity_entries + emission_results).
// isRawMaterial : ligne de traçabilité matière première — jamais calculée
// en V1 par choix méthodologique, distinct d'une donnée simplement absente.
export function determineLineStatus({ isRawMaterial, tco2e, verificationStatus }) {
  const needsVerification = verificationStatus === 'partiellement_verifie';
  if (isRawMaterial) {
    return { status: 'non_calcule', needsVerification: false };
  }
  if (tco2e === null || tco2e === undefined) {
    return { status: 'non_calcule', needsVerification: false };
  }
  return { status: Number(tco2e) === 0 ? 'zero_reel' : 'reel', needsVerification };
}

// Formatage tCO2e partagé — un seul point de vérité pour l'arrondi et le
// séparateur (fr-FR), afin qu'une même valeur ne s'affiche jamais
// différemment selon le rapport (ex. bug déjà rencontré ailleurs dans le
// projet : "80.00%" contre "80%" pour une même donnée NUMERIC Postgres).
export function formatTco2e(value, { maximumFractionDigits = 3 } = {}) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits });
}

// Pour une cellule de tableau où la valeur peut être non calculée : jamais
// une abréviation ambiguë ("n.c."), toujours le mot en toutes lettres dans
// un document destiné à être transmis à un client.
export function formatTco2eCell(value) {
  if (value === null || value === undefined) return STATUS_LABELS.non_calcule;
  return formatTco2e(value);
}
