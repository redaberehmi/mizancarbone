-- Up Migration

-- ============================================================
-- Module 3 — Taux de change, versionné comme les emission_factors
-- (exigence explicite : jamais un taux appliqué sans être enregistré et
-- daté). Utilisé pour convertir les montants d'achat/CA saisis en MAD vers
-- l'EUR, seule devise pour laquelle des ratios ADEME Base Empreinte existent.
-- ============================================================
CREATE TABLE exchange_rates (
    id              SERIAL PRIMARY KEY,
    base_currency   VARCHAR(3) NOT NULL DEFAULT 'EUR',
    quote_currency  VARCHAR(3) NOT NULL DEFAULT 'MAD',
    rate            NUMERIC(12,6) NOT NULL,      -- montant en quote_currency pour 1 base_currency
    source          VARCHAR(255) NOT NULL,
    valid_from      DATE NOT NULL,
    valid_to        DATE,                        -- NULL = taux courant
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_exchange_rates_dates ON exchange_rates (base_currency, quote_currency, valid_from, valid_to);

-- ============================================================
-- Module 3 — Correspondance secteur cible -> code NAF (référentiel utilisé
-- par la Base Empreinte ADEME). Table explicite, jamais un mapping caché
-- dans le code applicatif (exigence explicite du brief).
-- ============================================================
CREATE TABLE sector_naf_mapping (
    id                  SERIAL PRIMARY KEY,
    sector              VARCHAR(64) NOT NULL UNIQUE,   -- doit correspondre à companies.sector
    naf_code_reference  VARCHAR(16) NOT NULL,          -- code division NAF rév.2 (INSEE)
    naf_label           VARCHAR(255) NOT NULL,
    notes               TEXT,                          -- ex: granularité à affiner selon la sous-catégorie Base Empreinte
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Module 3 — traçabilité de la conversion de devise utilisée pour un calcul
-- Scope 3 spend-based. Additif, nullable : sans objet pour les résultats
-- Scope 1/2 qui ne font intervenir aucune conversion monétaire.
-- ============================================================
ALTER TABLE emission_results ADD COLUMN exchange_rate_id INTEGER REFERENCES exchange_rates(id);

-- Down Migration

ALTER TABLE emission_results DROP COLUMN IF EXISTS exchange_rate_id;
DROP TABLE IF EXISTS sector_naf_mapping;
DROP TABLE IF EXISTS exchange_rates;
