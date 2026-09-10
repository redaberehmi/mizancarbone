-- Up Migration

-- ============================================================
-- Entreprises et utilisateurs (multi-tenant)
-- ============================================================
CREATE TABLE companies (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    sector          VARCHAR(64)  NOT NULL,
    headcount       INTEGER,
    base_year       INTEGER,               -- année de référence GHG Protocol
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);
-- V1 : un compte = une entreprise = un utilisateur. Le schéma autorise déjà
-- plusieurs users par company_id pour V1.5, mais l'UI V1 n'expose qu'un seul
-- utilisateur par entreprise à la création.

CREATE TABLE sites (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    city            VARCHAR(128)
);

-- Traçabilité des recalculs d'année de référence (exigence GHG Protocol :
-- toute fusion, cession de site, ou changement de méthodologie qui affecte
-- la comparabilité dans le temps doit être documentée, jamais un recalcul
-- silencieux — sinon l'évolution affichée au dashboard perd sa validité méthodologique)
CREATE TABLE base_year_recalculations (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    previous_base_year  INTEGER NOT NULL,
    new_base_year       INTEGER NOT NULL,
    reason          TEXT NOT NULL,          -- ex: 'Cession du site de Tanger', 'Changement de méthodologie Scope 3'
    recalculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recalculated_by INTEGER REFERENCES users(id)
);

-- ============================================================
-- Facteurs d'émission — VERSIONNÉS (exigence de traçabilité
-- méthodologique pour audit / vérification externe future)
-- ============================================================
CREATE TABLE emission_factors (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(64)  NOT NULL,      -- ex: 'electricity_ma_location_based_kwh'
    label           VARCHAR(255) NOT NULL,
    scope           SMALLINT     NOT NULL CHECK (scope IN (1, 2, 3)),
    category        VARCHAR(64)  NOT NULL,      -- 'combustion_fixe' | 'combustion_mobile' | 'electricite_location_based' | 'electricite_market_based' | 'scope3_ratio'
    unit            VARCHAR(16)  NOT NULL,
    value_kgco2e    NUMERIC(14,6) NOT NULL,
    gas_breakdown   JSONB,                       -- {"CO2": x, "CH4": y, "N2O": z} en kgCO2e, optionnel
    source          VARCHAR(255) NOT NULL,       -- OBLIGATOIRE, jamais vide. Ex: 'Outil Bilan Carbone Maroc 2025', 'GHG Protocol/IEA générique — à remplacer'
    is_national     BOOLEAN NOT NULL DEFAULT false, -- true = facteur marocain officiel, false = générique international
    region          VARCHAR(32)  NOT NULL DEFAULT 'MA',
    valid_from      DATE         NOT NULL,
    valid_to        DATE,                        -- NULL = facteur courant
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (code, valid_from)
);
CREATE INDEX idx_emission_factors_code_dates ON emission_factors (code, valid_from, valid_to);

-- ============================================================
-- Données d'activité brutes (saisies par l'utilisateur)
-- ============================================================
CREATE TABLE activity_entries (
    id                  SERIAL PRIMARY KEY,
    company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    site_id             INTEGER REFERENCES sites(id) ON DELETE SET NULL,
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    factor_code         VARCHAR(64) NOT NULL,
    quantity             NUMERIC(18,4) NOT NULL,
    product_allocation   VARCHAR(255),           -- pour le module CBAM (répartition produit)
    source_document      VARCHAR(255),           -- nom du fichier importé, si applicable
    entered_by           INTEGER REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_entries_company_period ON activity_entries (company_id, period_start, period_end);

-- ============================================================
-- Résultats de calcul — traçabilité complète (quel facteur,
-- quelle version, pour quelle ligne — exigé pour audit futur)
-- ============================================================
CREATE TABLE emission_results (
    id                  SERIAL PRIMARY KEY,
    activity_entry_id   INTEGER NOT NULL REFERENCES activity_entries(id) ON DELETE CASCADE,
    emission_factor_id  INTEGER NOT NULL REFERENCES emission_factors(id),
    scope               SMALLINT NOT NULL,
    tco2e               NUMERIC(18,6) NOT NULL,
    verification_status  VARCHAR(24) NOT NULL DEFAULT 'non_verifie', -- 'non_verifie' | 'partiellement_verifie' | 'totalement_verifie' — champ prévu pour V1.5, garder dès V1
    calculated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Module 5 — Dispositifs de financement (contenu maintenu manuellement en V1)
-- ============================================================
CREATE TABLE financing_programs (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,       -- ex: 'Tatwir Croissance Verte', 'PACT DÉCARBONATION/EAU', 'Audit énergétique AMEE'
    description     TEXT,
    subsidy_rate    NUMERIC(5,2),                -- ex: 80.00 pour 80%
    cap_amount_mad  NUMERIC(14,2),
    eligibility     TEXT,
    source_url      VARCHAR(500),
    active          BOOLEAN NOT NULL DEFAULT true,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Module 5 — Simulateur taxe carbone nationale (paramètres versionnés)
-- ============================================================
CREATE TABLE carbon_tax_parameters (
    id              SERIAL PRIMARY KEY,
    valid_from      DATE NOT NULL,
    valid_to        DATE,
    rate_per_tco2e  NUMERIC(10,2) NOT NULL,      -- MAD par tCO2e, à paramétrer selon LF2026 dès publication officielle
    threshold_tco2e NUMERIC(14,2),               -- seuil d'assujettissement s'il existe
    source          VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS carbon_tax_parameters;
DROP TABLE IF EXISTS financing_programs;
DROP TABLE IF EXISTS emission_results;
DROP TABLE IF EXISTS activity_entries;
DROP TABLE IF EXISTS emission_factors;
DROP TABLE IF EXISTS base_year_recalculations;
DROP TABLE IF EXISTS sites;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS companies;
