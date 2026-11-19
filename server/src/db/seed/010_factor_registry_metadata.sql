-- ============================================================
-- Métadonnées de registre des facteurs déjà présents (seeds 001, 003, 007,
-- 008). Idempotent : uniquement des UPDATE de métadonnées, jamais de la
-- valeur value_kgco2e ni des dates de validité — les résultats déjà
-- calculés ne changent pas.
-- ============================================================

-- Électricité 0,644 (périodes 2024-2025) : provenance primaire non
-- retrouvée dans le projet. Ni l'année représentée ni la couverture
-- (production seule ou pertes incluses) ne sont documentées.
UPDATE emission_factors SET
    factor_uid = 'GENERIQUE-V1/electricity_ma_location_based_kwh',
    version_label = 'generique-v1',
    activity_label = 'Électricité consommée depuis le réseau national',
    gases_covered = 'Non précisé',
    geography = 'Maroc',
    represented_year = '2024 (selon le libellé, non confirmé)',
    integration_date = '2024-01-01',
    boundary = 'mix_inconnu',
    source_original = 'Source secondaire non identifiée (« Mix électrique Maroc 2024 — générique »)',
    uncertainty_pct = NULL,
    usage_restrictions = 'Provenance primaire, année représentée et couverture (production seule ou pertes réseau incluses) non documentées. Conservé uniquement pour ne pas modifier silencieusement les résultats 2024-2025 déjà calculés.',
    methodological_status = 'source_secondaire',
    rights_status = 'non_applicable'
WHERE code = 'electricity_ma_location_based_kwh' AND valid_from = '2024-01-01';

-- Électricité 0,6426 (FM6E, à partir du 2026-01-01). Valeur du classeur :
-- 0,6426025 (= 0,721 / 1,122) ; arrondie à 0,6426 lors de l'intégration
-- d'octobre 2026, conservée telle quelle pour la stabilité des résultats.
UPDATE emission_factors SET
    factor_uid = 'FM6E-BEGES/draft-2024-10-15/P6-S2-ConsommationElectricité!C49',
    version_label = 'draft-2024-10-15',
    activity_label = 'Électricité réseau national - Mix moyen 2020',
    gases_covered = 'Non décomposé (CO2e total)',
    geography = 'Maroc',
    represented_year = '2020',
    publication_date = 'Version « draft » du 15/10/2024 (nom du fichier) — aucune version plus récente connue',
    integration_date = '2026-10-09',
    boundary = 'mix_production',
    source_original = 'FM6E',
    source_file = 'Bilan Carbone Maroc-compatible postes iso14064 et GHG Protocol-draft-15 octobre 2024.xlsx',
    source_sheet = 'P6-S2-ConsommationElectricité',
    source_cell = 'C49 (formule : =0.721/(1.122))',
    uncertainty_pct = 10,
    usage_restrictions = 'Mix de l''année 2020, utilisé faute de donnée plus récente. Exclut les pertes en ligne (12,2 %, cellule C50), que le classeur ajoute séparément ; dans MizanCarbone elles relèvent du Scope 3 cat. 3. Valeur arrondie à 0,6426 (classeur : 0,6426025). Signification exacte de la division par 1,122 à confirmer avec la FM6E.',
    validity_note = 'Révision annuelle ; actualisation : MTEDD, ONEE ; validation : entité en charge du FE, l''ONEE et le DDD (feuille « Validité facteurs émission »)',
    methodological_status = 'a_confirmer',
    rights_status = 'a_confirmer'
WHERE code = 'electricity_ma_location_based_kwh' AND valid_from = '2026-01-01';

-- Combustibles génériques (seed 001).
UPDATE emission_factors SET
    factor_uid = 'GENERIQUE-V1/' || code,
    version_label = 'generique-v1',
    activity_label = label,
    gases_covered = 'Non précisé',
    geography = 'Non précisée',
    represented_year = 'Non indiquée',
    integration_date = '2024-01-01',
    boundary = 'combustion',
    source_original = 'Source secondaire non identifiée (« Facteur standard GHG Protocol/IEA »)',
    usage_restrictions = 'Périmètre « combustion seule » présumé d''après l''ordre de grandeur et le libellé de la source ; source primaire, gaz couverts et PRG non documentés. À remplacer par un facteur de combustion seule sourcé.',
    methodological_status = 'source_secondaire',
    rights_status = 'non_applicable'
WHERE code IN ('diesel_L', 'gasoline_L', 'natural_gas_m3', 'lpg_kg', 'fuel_oil_L') AND valid_from = '2024-01-01';

-- Ancienne méthode « ratio sectoriel global » (seed 003) : isolée.
UPDATE emission_factors SET
    boundary = 'monetaire',
    usage_restrictions = 'Méthode isolée : appliquer un ratio unique lié au secteur de l''entreprise à toutes ses dépenses n''est plus proposé. Remplacée par les achats par catégorie.',
    methodological_status = 'retire',
    rights_status = 'non_applicable'
WHERE category = 'scope3_ratio';

-- Facteurs de « production » électrique (seed 008, déjà désactivés par 009).
UPDATE emission_factors SET
    boundary = 'cycle_de_vie',
    geography = 'France',
    represented_year = '2016 (publication)',
    usage_restrictions = 'Valeurs d''analyse de cycle de vie (construction incluse) d''une étude française : non admissibles comme taux d''émission direct d''un instrument contractuel (GHG Protocol Scope 2, tableau 6.3).',
    methodological_status = 'non_utilisable',
    rights_status = 'non_applicable'
WHERE category = 'electricite_market_based' AND code LIKE 'electricity_production_%';
