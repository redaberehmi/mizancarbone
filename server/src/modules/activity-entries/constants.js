// Code sentinelle pour les entrées "matières premières" de traçabilité
// (Module 2, utiles à la préparation CBAM) : ne correspond à AUCUNE ligne de
// emission_factors, aucune émission n'est calculée ligne par ligne. Les
// achats de matières à comptabiliser en Scope 3 se saisissent comme achats
// (catégorie 1) avec un facteur physique explicite.
export const RAW_MATERIAL_FACTOR_CODE = 'matiere_premiere_non_calculee';

// Catégories saisissables en Scope 1 / Scope 2 (quantité × facteur).
// 'electricite_market_based' n'en fait plus partie : le market-based est
// calculé à partir des instruments contractuels alloués à la consommation
// (module électricité), jamais par une seconde saisie de consommation.
export const DIRECT_ENTRY_CATEGORIES = [
  'combustion_fixe',
  'combustion_mobile',
  'procede',
  'fugitive',
  'electricite_location_based',
];

// Catégories Scope 3 saisissables ligne par ligne.
export const SCOPE3_ENTRY_CATEGORIES = [
  'scope3_achat_physique',
  'scope3_achat_monetaire',
  'scope3_immobilisation',
  'scope3_dechets',
  'scope3_fret',
  'scope3_pertes_reseau',
];

export const ALL_ENTRY_CATEGORIES = [...DIRECT_ENTRY_CATEGORIES, ...SCOPE3_ENTRY_CATEGORIES];

// Libellés des postes Scope 1.
export const SCOPE1_CATEGORY_LABELS = {
  combustion_fixe: 'Combustion — sources fixes',
  combustion_mobile: 'Combustion — sources mobiles',
  procede: 'Émissions de procédés (hors combustion)',
  fugitive: 'Émissions fugitives (fluides frigorigènes)',
};

// Les 15 catégories Scope 3 du GHG Protocol (Corporate Value Chain Standard).
export const SCOPE3_CATEGORY_LABELS = {
  1: 'Achats de biens et services',
  2: "Biens d'équipement (immobilisations)",
  3: 'Combustibles et énergie (amont, pertes réseau) non inclus en Scope 1 et 2',
  4: 'Transport et distribution amont',
  5: "Déchets générés par l'activité",
  6: 'Déplacements professionnels',
  7: 'Trajets domicile-travail',
  8: 'Actifs loués en amont',
  9: 'Transport et distribution aval',
  10: 'Transformation des produits vendus',
  11: 'Utilisation des produits vendus',
  12: 'Fin de vie des produits vendus',
  13: 'Actifs loués en aval',
  14: 'Franchises',
  15: 'Investissements',
};

// Catégorie Scope 3 par défaut d'une catégorie de facteur (le fret est
// choisi explicitement à la saisie : 4 amont ou 9 aval).
export const DEFAULT_SCOPE3_CATEGORY = {
  scope3_achat_physique: 1,
  scope3_achat_monetaire: 1,
  scope3_immobilisation: 2,
  scope3_dechets: 5,
  scope3_pertes_reseau: 3,
};

// Périmètres admis par scope : un facteur « combustion + amont » ne peut
// jamais produire un résultat Scope 1.
export const SCOPE1_ALLOWED_BOUNDARIES = ['combustion', 'procede', 'fugitive'];
export const UNUSABLE_METHOD_STATUSES = ['non_utilisable', 'retire'];
