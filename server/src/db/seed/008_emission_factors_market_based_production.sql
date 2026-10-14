-- Active le Scope 2 market-based, jusqu'ici toujours défaulté sur le
-- location-based faute de facteurs "electricite_market_based" en base (voir
-- commentaire calculation.service.js ligne ~193 : le mécanisme de double
-- reporting était déjà câblé -- scope2MarketBasedIsDefaulted,
-- DIRECT_ENTRY_CATEGORIES, regroupement UI DataCollection.jsx -- il
-- manquait seulement les facteurs eux-mêmes).
--
-- Usage prévu : une entreprise qui a un contrat d'électricité spécifique
-- (PPA, garantie d'origine) pour tout ou partie de sa consommation saisit
-- une entrée "énergie" distincte avec le facteur de production correspondant
-- au lieu du facteur réseau national -- cette entrée alimente alors le
-- Scope 2 market-based au lieu du location-based. Une entreprise sans
-- contrat spécifique continue de n'utiliser que le facteur réseau national
-- (electricity_ma_location_based_kwh) : le market-based reste alors défaulté
-- sur le location-based, comme avant.
--
-- Source : même fichier reçu via expert carbone (FM6) le 2026-10-09 que la
-- migration précédente (007), onglet P6-S2-ConsommationElectricité,
-- "Tableau 5 : Facteurs d'Emissions Electricité (kgCO2e/kWh) - production".
-- Ces facteurs ne sont PAS sourcés FM6E/Maroc contrairement aux facteurs de
-- la migration 007 : leur source primaire citée dans le fichier est une
-- étude française ("Quel Bilan Carbone des sources de production
-- d'électricité en France ?", Réseau durable, 2016). Traités comme des
-- facteurs technologiques génériques (is_national = false) : la physique
-- d'une centrale éolienne ou thermique au gaz ne dépend pas du pays, mais ce
-- ne sont pas des facteurs "officiels Maroc" au même titre que 007.
INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from) VALUES
(
    'electricity_production_eolien_kwh',
    'Électricité — contrat production éolienne',
    2, 'electricite_market_based', 'kWh', 0.0127,
    'Réseau durable, "Quel Bilan Carbone des sources de production d''électricité en France ?", 2016 (via expert carbone FM6, 2026-10-09). Facteur technologique générique, non spécifique Maroc.',
    false, 'MA', '2024-01-01'
),
(
    'electricity_production_hydraulique_kwh',
    'Électricité — contrat production hydraulique',
    2, 'electricite_market_based', 'kWh', 0.006,
    'Réseau durable, "Quel Bilan Carbone des sources de production d''électricité en France ?", 2016 (via expert carbone FM6, 2026-10-09). Facteur technologique générique, non spécifique Maroc.',
    false, 'MA', '2024-01-01'
),
(
    'electricity_production_solaire_kwh',
    'Électricité — contrat production solaire',
    2, 'electricite_market_based', 'kWh', 0.055,
    'Réseau durable, "Quel Bilan Carbone des sources de production d''électricité en France ?", 2016 (via expert carbone FM6, 2026-10-09). Facteur technologique générique, non spécifique Maroc.',
    false, 'MA', '2024-01-01'
),
(
    'electricity_production_thermique_charbon_kwh',
    'Électricité — contrat production thermique (charbon)',
    2, 'electricite_market_based', 'kWh', 1.06,
    'Réseau durable, "Quel Bilan Carbone des sources de production d''électricité en France ?", 2016 (via expert carbone FM6, 2026-10-09). Facteur technologique générique, non spécifique Maroc.',
    false, 'MA', '2024-01-01'
),
(
    'electricity_production_thermique_fioul_kwh',
    'Électricité — contrat production thermique (fioul)',
    2, 'electricite_market_based', 'kWh', 0.73,
    'Réseau durable, "Quel Bilan Carbone des sources de production d''électricité en France ?", 2016 (via expert carbone FM6, 2026-10-09). Facteur technologique générique, non spécifique Maroc.',
    false, 'MA', '2024-01-01'
),
(
    'electricity_production_thermique_gaz_kwh',
    'Électricité — contrat production thermique (gaz naturel)',
    2, 'electricite_market_based', 'kWh', 0.418,
    'Réseau durable, "Quel Bilan Carbone des sources de production d''électricité en France ?", 2016 (via expert carbone FM6, 2026-10-09). Facteur technologique générique, non spécifique Maroc.',
    false, 'MA', '2024-01-01'
)
ON CONFLICT (code, valid_from) DO NOTHING;
