// Code sentinelle pour les entrées "matières premières" : ne correspond à
// AUCUNE ligne de emission_factors — le Scope 3 est calculé au Module 3 via
// un ratio sectoriel global (CA ou achats × ratio tCO2e/MDH), jamais ligne
// par ligne. Ces entrées sont de la donnée de traçabilité (utile au Module 4
// CBAM), pas une donnée avec émissions calculées. Voir README, section
// "Écarts par rapport au brief (Module 2)".
export const RAW_MATERIAL_FACTOR_CODE = 'matiere_premiere_non_calculee';

// Catégories d'emission_factors utilisables pour une saisie manuelle directe
// (Scope 1 & 2). 'scope3_ratio' est exclu : c'est un ratio agrégé, pas un
// facteur à multiplier par une quantité saisie ligne par ligne.
export const DIRECT_ENTRY_CATEGORIES = [
  'combustion_fixe',
  'combustion_mobile',
  'electricite_location_based',
  'electricite_market_based',
];
