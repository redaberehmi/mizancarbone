-- Up Migration

-- ============================================================
-- Corrections après relecture (2026-11-19). Migration SÉPARÉE et
-- idempotente : elle s'applique aussi bien à une base où la migration
-- 1738000011000 a déjà été exécutée qu'à une installation neuve. Aucune
-- donnée existante n'est modifiée.
-- ============================================================

-- Élargissements (sans perte ; sans effet si déjà appliqués).
ALTER TABLE emission_results ALTER COLUMN verification_status TYPE VARCHAR(32);
ALTER TABLE emission_factors ALTER COLUMN value_kgco2e TYPE NUMERIC(24,12);

-- Facteur correctif d'une version existante (correction d'erreur ou
-- changement de méthode portant sur une période passée). Utilisé UNIQUEMENT
-- par un recalcul validé de l'année de référence : les résultats déjà
-- enregistrés ne changent jamais.
ALTER TABLE emission_factors ADD COLUMN IF NOT EXISTS corrects_factor_id INTEGER REFERENCES emission_factors(id);

-- Critères de qualité Scope 2 n° 6 (taux / contrat fournisseur) et n° 7
-- (achat direct auprès d'un producteur), GHG Protocol Scope 2, tableau 7.1.
ALTER TABLE electricity_contracts ADD COLUMN IF NOT EXISTS qc_supplier_delivered_basis BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE electricity_contracts ADD COLUMN IF NOT EXISTS qc_direct_claims_transferred BOOLEAN NOT NULL DEFAULT false;

-- Versions de l'inventaire de l'année de référence : la version initiale et
-- chaque recalcul validé sont conservés (jamais écrasés).
CREATE TABLE IF NOT EXISTS base_year_inventory_versions (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    base_year       INTEGER NOT NULL,
    version_number  INTEGER NOT NULL,
    review_id       INTEGER REFERENCES base_year_recalculation_reviews(id) ON DELETE SET NULL,
    origin          VARCHAR(24) NOT NULL CHECK (origin IN ('initiale', 'recalcul_valide')),
    scope1_tco2e    NUMERIC(18,6) NOT NULL,
    scope2_location_tco2e NUMERIC(18,6) NOT NULL,
    scope3_tco2e    NUMERIC(18,6) NOT NULL,
    total_scope12_tco2e NUMERIC(18,6) NOT NULL,
    excluded_site_ids INTEGER[] NOT NULL DEFAULT '{}',
    lines           JSONB NOT NULL,
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, base_year, version_number)
);

-- Down Migration

DROP TABLE IF EXISTS base_year_inventory_versions;
ALTER TABLE electricity_contracts DROP COLUMN IF EXISTS qc_direct_claims_transferred;
ALTER TABLE electricity_contracts DROP COLUMN IF EXISTS qc_supplier_delivered_basis;
ALTER TABLE emission_factors DROP COLUMN IF EXISTS corrects_factor_id;
