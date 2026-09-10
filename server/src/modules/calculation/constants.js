// Incertitude documentée par l'ADEME elle-même sur les ratios monétaires de
// la Base Empreinte (approche spend-based). Doit être affichée explicitement
// à côté de tout résultat Scope 3 qui en dépend — jamais en note de bas de
// page (exigence explicite du brief) — ce qui matérialise la règle déjà
// actée : le Scope 3 n'est jamais présenté avec le même niveau de confiance
// que le Scope 1/2.
export const SCOPE3_RATIO_UNCERTAINTY = {
  minPercent: 30,
  maxPercent: 80,
  note: "Incertitude documentée par l'ADEME (Base Empreinte) sur les ratios monétaires (approche spend-based). Cette estimation est structurellement moins fiable qu'un calcul Scope 1/2 basé sur des données d'activité physiques.",
};

export function scope3RatioFactorCode(sector) {
  return `scope3_ratio_${sector}`;
}
