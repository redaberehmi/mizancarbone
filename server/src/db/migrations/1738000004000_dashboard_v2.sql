-- Up Migration

-- Champ optionnel pour calculer l'intensité carbone (tCO2e/MDH) — jamais
-- renseigné automatiquement, l'entreprise le déclare elle-même dans son profil.
ALTER TABLE companies ADD COLUMN annual_revenue_mad NUMERIC(16,2);

-- Fréquence de reporting déclarée par l'entreprise — nécessaire pour évaluer
-- "données manquantes" et "complétude des données" (dashboard v2, section E/3) :
-- sans cette déclaration, ces deux indicateurs ne peuvent pas être calculés
-- (pas de valeur par défaut inventée, l'UI doit afficher un état "non renseigné").
ALTER TABLE companies ADD COLUMN reporting_frequency VARCHAR(16)
    CHECK (reporting_frequency IS NULL OR reporting_frequency IN ('mensuelle', 'trimestrielle', 'annuelle'));

-- ============================================================
-- Benchmarks sectoriels — structure prête, jamais peuplée avec une
-- estimation. Même discipline que financing_programs : reste vide tant
-- qu'aucune donnée vérifiée (AMEE, CGEM, étude sectorielle) n'est fournie.
-- ============================================================
CREATE TABLE sector_benchmarks (
    id                       SERIAL PRIMARY KEY,
    sector                   VARCHAR(64) NOT NULL,
    intensity_tco2e_per_mdh  NUMERIC(14,4),
    source                   VARCHAR(255) NOT NULL,
    valid_from               DATE NOT NULL,
    valid_to                 DATE
);

-- ============================================================
-- Seuils des alarmes auto-référencées (dashboard v2, section 3) — seuils
-- opérationnels de bon sens, pas des données externes à vérifier : peuvent
-- être seedés directement, contrairement à emission_factors/financing_programs.
-- ============================================================
CREATE TABLE alert_thresholds (
    id                  SERIAL PRIMARY KEY,
    code                VARCHAR(64) NOT NULL UNIQUE,
    label               VARCHAR(255) NOT NULL,
    threshold_value     NUMERIC(10,4) NOT NULL,
    unit                VARCHAR(16) NOT NULL,
    active              BOOLEAN NOT NULL DEFAULT true
);

-- Down Migration

DROP TABLE IF EXISTS alert_thresholds;
DROP TABLE IF EXISTS sector_benchmarks;
ALTER TABLE companies DROP COLUMN IF EXISTS reporting_frequency;
ALTER TABLE companies DROP COLUMN IF EXISTS annual_revenue_mad;
