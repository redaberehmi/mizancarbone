// Secteurs réellement couverts par le CBAM parmi les 10 secteurs cibles de la
// plateforme (brief, module 4, étendu pour inclure les 6 catégories officielles
// CBAM ci-dessous comme secteurs à part entière). 'metallurgie' reste couverte
// (secteur historique du brief, recoupe souvent fer_et_acier/aluminium) ; les
// 3 secteurs d'origine restants (automobile, textile, agroalimentaire) restent
// accessibles mais en option secondaire, avec explication.
export const CBAM_COVERED_SECTORS = [
  'metallurgie',
  'fer_et_acier',
  'aluminium',
  'ciment',
  'engrais',
  'electricite',
  'hydrogene',
];

// Catégories officiellement couvertes par le règlement CBAM européen —
// affichées à titre informatif, jamais utilisées pour calculer quoi que ce
// soit (le calcul d'émissions intégrées par code SH est hors-scope V1).
export const CBAM_OFFICIAL_CATEGORIES = [
  'Fer et acier',
  'Aluminium',
  'Ciment',
  'Engrais',
  'Électricité',
  'Hydrogène',
];

// ============================================================
// Vocabulaire verrouillé (brief, section 8) — non négociable.
//
// Le déclarant CBAM est toujours l'importateur européen, jamais
// l'exportateur marocain. Cet outil structure des données que l'entreprise
// transmettra elle-même à son client européen ; il ne soumet rien à aucune
// autorité. "déclaration" est banni du vocabulaire de ce module dans son
// ensemble (pas seulement la phrase "déclaration CBAM clé en main") : toute
// formulation qui laisse penser à une soumission officielle est fausse, pas
// juste mal formulée.
//
// Utilisé par tests/cbam-vocabulary.test.js pour scanner automatiquement
// les fichiers de ce module (UI, PDF, messages d'erreur) et empêcher qu'un
// de ces mots se glisse discrètement dans un futur changement.
// ============================================================
export const FORBIDDEN_PHRASES = [
  'déclaration',
  'declaration',
  'clé en main',
  'cle en main',
  'certifié imanor',
  'certifie imanor',
  'soumission au registre',
  'soumis au registre',
  'registre européen',
  'registre europeen',
  'submit to the registry',
];
