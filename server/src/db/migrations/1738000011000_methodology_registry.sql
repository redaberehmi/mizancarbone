-- Up Migration

-- ============================================================
-- Révision méthodologique (retour de l'experte carbone, nov. 2026).
-- Migration strictement ADDITIVE : aucune colonne existante supprimée, aucun
-- résultat existant recalculé. Les anciennes lignes restent lisibles telles
-- qu'elles ont été produites ; seules des métadonnées sont ajoutées.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Registre des facteurs d'émission : métadonnées de traçabilité.
-- ------------------------------------------------------------
-- Certaines unités sources dépassent 16 caractères (ex. « t déchets enfouis »).
ALTER TABLE emission_factors ALTER COLUMN unit TYPE VARCHAR(48);
-- Précision élargie (sans perte) : certaines valeurs sources ont plus de 6 décimales.
ALTER TABLE emission_factors ALTER COLUMN value_kgco2e TYPE NUMERIC(24,12);
ALTER TABLE emission_factors ALTER COLUMN code TYPE VARCHAR(96);
ALTER TABLE activity_entries ALTER COLUMN factor_code TYPE VARCHAR(96);

ALTER TABLE emission_factors
    ADD COLUMN factor_uid            VARCHAR(160),
    ADD COLUMN version_label         VARCHAR(64),
    ADD COLUMN activity_label        VARCHAR(255),
    ADD COLUMN gases_covered         VARCHAR(128),
    ADD COLUMN gwp_reference         VARCHAR(255),
    ADD COLUMN geography             VARCHAR(255),
    ADD COLUMN technology            VARCHAR(160),
    -- Année REPRÉSENTÉE par la valeur (ex. mix 2020) — jamais confondue avec
    -- valid_from/valid_to (période pour laquelle l'utilisation est retenue)
    -- ni avec integration_date (date d'entrée dans MizanCarbone).
    ADD COLUMN represented_year      VARCHAR(64),
    ADD COLUMN publication_date      VARCHAR(255),
    ADD COLUMN integration_date      DATE,
    ADD COLUMN boundary              VARCHAR(32),
    ADD COLUMN source_original       VARCHAR(500),
    ADD COLUMN source_file           VARCHAR(255),
    ADD COLUMN source_sheet          VARCHAR(128),
    ADD COLUMN source_cell           VARCHAR(160),
    ADD COLUMN uncertainty_pct       NUMERIC(8,2),
    ADD COLUMN usage_restrictions    TEXT,
    ADD COLUMN validity_note         TEXT,
    ADD COLUMN methodological_status VARCHAR(32) NOT NULL DEFAULT 'a_confirmer',
    ADD COLUMN rights_status         VARCHAR(32) NOT NULL DEFAULT 'non_applicable',
    ADD COLUMN scope3_category       SMALLINT,
    ADD COLUMN import_batch_id       INTEGER;

ALTER TABLE emission_factors ADD CONSTRAINT emission_factors_boundary_chk CHECK (
    boundary IS NULL OR boundary IN (
        'combustion',            -- émissions directes de combustion seule
        'combustion_amont',      -- combustion + amont, non décomposé
        'amont',                 -- amont seul (extraction, raffinage, transport du combustible)
        'procede',               -- émissions de procédé (hors combustion)
        'fugitive',              -- PRG d'un gaz (fuite = masse émise)
        'mix_production',        -- mix de production électrique, hors pertes réseau
        'mix_inconnu',           -- facteur électrique dont la couverture n'est pas documentée
        'pertes_reseau',         -- pertes en ligne (Scope 3 cat. 3)
        'cycle_de_vie',          -- ACV (construction incluse)
        'berceau_porte',         -- fabrication jusqu'à la sortie d'usine
        'transport_amont_combustion', -- fret « amont et combustion » (du puits à la roue)
        'fin_de_vie',
        'monetaire',             -- ratio par montant dépensé
        'non_precise'
    )
);
ALTER TABLE emission_factors ADD CONSTRAINT emission_factors_method_status_chk CHECK (
    methodological_status IN ('valide_source_primaire', 'a_confirmer', 'source_secondaire', 'non_utilisable', 'retire')
);
ALTER TABLE emission_factors ADD CONSTRAINT emission_factors_rights_status_chk CHECK (
    rights_status IN ('non_applicable', 'a_confirmer', 'confirme', 'refuse')
);
ALTER TABLE emission_factors ADD CONSTRAINT emission_factors_scope3_cat_chk CHECK (
    scope3_category IS NULL OR scope3_category BETWEEN 1 AND 15
);
CREATE UNIQUE INDEX idx_emission_factors_uid_version ON emission_factors (factor_uid, valid_from)
    WHERE factor_uid IS NOT NULL;

-- Lots d'import (import reproductible du classeur FM6E ou d'une autre source).
CREATE TABLE factor_import_batches (
    id              SERIAL PRIMARY KEY,
    source_file     VARCHAR(255) NOT NULL,
    file_sha256     CHAR(64) NOT NULL,
    source_version  VARCHAR(64) NOT NULL,
    mode            VARCHAR(16) NOT NULL CHECK (mode IN ('apercu', 'applique')),
    accepted_count  INTEGER NOT NULL DEFAULT 0,
    rejected_count  INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    report          JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE factor_import_rejections (
    id          SERIAL PRIMARY KEY,
    batch_id    INTEGER NOT NULL REFERENCES factor_import_batches(id) ON DELETE CASCADE,
    sheet       VARCHAR(128) NOT NULL,
    cell        VARCHAR(32) NOT NULL,
    label       VARCHAR(500),
    reason      TEXT NOT NULL
);

-- ------------------------------------------------------------
-- 2. Données d'activité : origine de la donnée, justificatif, contrôle
--    interne, champs propres aux nouveaux postes (fret, achats, frigorigènes).
-- ------------------------------------------------------------
ALTER TABLE activity_entries
    ADD COLUMN data_origin             VARCHAR(16)
        CHECK (data_origin IS NULL OR data_origin IN ('mesuree', 'estimee')),
    ADD COLUMN internal_control_status VARCHAR(32) NOT NULL DEFAULT 'non_controle'
        CHECK (internal_control_status IN ('non_controle', 'controle_interne_effectue', 'anomalie_signalee')),
    ADD COLUMN internal_control_note   TEXT,
    ADD COLUMN internal_control_by     INTEGER REFERENCES users(id),
    ADD COLUMN internal_control_at     TIMESTAMPTZ,
    ADD COLUMN scope3_category         SMALLINT CHECK (scope3_category IS NULL OR scope3_category BETWEEN 1 AND 15),
    ADD COLUMN amount_mad              NUMERIC(18,2),
    ADD COLUMN mass_tonnes             NUMERIC(18,4),
    ADD COLUMN distance_km             NUMERIC(18,3),
    ADD COLUMN purchase_category       VARCHAR(64),
    ADD COLUMN factor_justification    TEXT,
    ADD COLUMN description             VARCHAR(255);

-- Statut porté par le résultat : les anciens libellés « partiellement /
-- totalement vérifié » laissaient croire à une vérification. Ils sont
-- convertis en statuts de CONTRÔLE INTERNE (aucune donnée n'a jamais été
-- vérifiée par un tiers dans l'outil).
ALTER TABLE emission_results ALTER COLUMN verification_status TYPE VARCHAR(32);
ALTER TABLE emission_results ALTER COLUMN verification_status SET DEFAULT 'non_controle';
UPDATE emission_results SET verification_status = CASE verification_status
    WHEN 'non_verifie' THEN 'non_controle'
    WHEN 'partiellement_verifie' THEN 'controle_interne_partiel'
    WHEN 'totalement_verifie' THEN 'controle_interne_effectue'
    ELSE verification_status END;
ALTER TABLE emission_results ADD CONSTRAINT emission_results_control_status_chk CHECK (
    verification_status IN ('non_controle', 'controle_interne_partiel', 'controle_interne_effectue')
);

-- Instruments contractuels d'électricité (Scope 2 market-based). La
-- consommation totale reste saisie une seule fois (entrée électricité
-- réseau du site/période) ; les contrats en sont des ALLOCATIONS, jamais
-- une consommation supplémentaire — ce qui évite le double compte.
CREATE TABLE electricity_contracts (
    id                    SERIAL PRIMARY KEY,
    company_id            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    site_id               INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    instrument_type       VARCHAR(32) NOT NULL CHECK (instrument_type IN (
        'certificat_attributs', 'contrat_fourniture_direct', 'contrat_fournisseur',
        'taux_fournisseur', 'autoconsommation', 'vente_electricite')),
    supplier              VARCHAR(255),
    installation          VARCHAR(255),
    technology            VARCHAR(128),
    period_start          DATE NOT NULL,
    period_end            DATE NOT NULL,
    volume_kwh            NUMERIC(18,3) NOT NULL CHECK (volume_kwh > 0),
    -- Facteur d'émission DIRECT (combustion seule) attaché à l'instrument.
    -- NULL = non communiqué : l'instrument ne peut pas être utilisé.
    factor_kgco2e_per_kwh NUMERIC(14,6) CHECK (factor_kgco2e_per_kwh IS NULL OR factor_kgco2e_per_kwh >= 0),
    factor_source         VARCHAR(500),
    document_reference    VARCHAR(255),
    -- Critères de qualité Scope 2 (GHG Protocol Scope 2 Guidance, tableau 7.1),
    -- déclarés par l'entreprise, jamais présumés.
    qc_conveys_attribute       BOOLEAN NOT NULL DEFAULT false,
    qc_unique_claim            BOOLEAN NOT NULL DEFAULT false,
    qc_retired_on_behalf       BOOLEAN NOT NULL DEFAULT false,
    qc_vintage_close_to_period BOOLEAN NOT NULL DEFAULT false,
    qc_same_market             BOOLEAN NOT NULL DEFAULT false,
    notes                 TEXT,
    created_by            INTEGER REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end >= period_start)
);
CREATE INDEX idx_electricity_contracts_company ON electricity_contracts (company_id, site_id, period_start);

-- ------------------------------------------------------------
-- 3. Périmètre organisationnel et politique d'année de référence.
-- ------------------------------------------------------------
ALTER TABLE companies
    ADD COLUMN consolidation_approach   VARCHAR(32) NOT NULL DEFAULT 'controle_operationnel'
        CHECK (consolidation_approach IN ('controle_operationnel')),
    ADD COLUMN boundary_description     TEXT,
    ADD COLUMN activity_role            VARCHAR(32) NOT NULL DEFAULT 'consommateur'
        CHECK (activity_role IN ('consommateur', 'producteur_electricite', 'producteur_hydrogene')),
    -- Seuil de significativité choisi PAR L'ENTREPRISE (aucune valeur par
    -- défaut : le GHG Protocol n'impose pas de seuil chiffré).
    ADD COLUMN base_year_threshold_pct  NUMERIC(6,2)
        CHECK (base_year_threshold_pct IS NULL OR (base_year_threshold_pct > 0 AND base_year_threshold_pct <= 100)),
    ADD COLUMN base_year_policy_notes   TEXT;

CREATE TABLE organizational_boundary_items (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    item_type       VARCHAR(24) NOT NULL CHECK (item_type IN ('site', 'entite', 'operation', 'actif_loue', 'exclusion')),
    name            VARCHAR(255) NOT NULL,
    site_id         INTEGER REFERENCES sites(id) ON DELETE SET NULL,
    included        BOOLEAN NOT NULL,
    -- Contrôle opérationnel : l'entreprise a-t-elle l'autorité de mettre en
    -- œuvre ses politiques d'exploitation ? Distinct de la détention.
    has_operational_control BOOLEAN,
    ownership_pct   NUMERIC(6,2) CHECK (ownership_pct IS NULL OR (ownership_pct >= 0 AND ownership_pct <= 100)),
    justification   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE base_year_recalculation_reviews (
    id                     SERIAL PRIMARY KEY,
    company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    base_year              INTEGER NOT NULL,
    trigger_type           VARCHAR(32) NOT NULL CHECK (trigger_type IN (
        'changement_structurel', 'changement_methodologique', 'correction_erreur')),
    description            TEXT NOT NULL,
    estimated_impact_tco2e NUMERIC(18,6) NOT NULL,
    base_year_total_tco2e  NUMERIC(18,6),
    impact_pct             NUMERIC(10,4),
    cumulative_impact_pct  NUMERIC(10,4),
    threshold_pct          NUMERIC(6,2),
    recommendation         VARCHAR(32) NOT NULL CHECK (recommendation IN (
        'recalcul_recommande', 'sous_le_seuil', 'seuil_non_defini', 'annee_reference_sans_donnees')),
    decision               VARCHAR(24) NOT NULL DEFAULT 'en_attente' CHECK (decision IN (
        'en_attente', 'recalcul_valide', 'recalcul_non_retenu')),
    decision_note          TEXT,
    decided_by             INTEGER REFERENCES users(id),
    decided_at             TIMESTAMPTZ,
    snapshot               JSONB NOT NULL,
    created_by             INTEGER REFERENCES users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 4. Vérification externe (avis d'un organisme tiers) — enregistrement
--    seulement : MizanCarbone ne vérifie rien.
-- ------------------------------------------------------------
CREATE TABLE external_assurance_statements (
    id                   SERIAL PRIMARY KEY,
    company_id           INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider_name        VARCHAR(255) NOT NULL,
    statement_date       DATE NOT NULL,
    scope_description    TEXT NOT NULL,
    assurance_level      VARCHAR(16) NOT NULL CHECK (assurance_level IN ('limitee', 'raisonnable', 'non_precise')),
    standard_reference   VARCHAR(255),
    document_reference   VARCHAR(255) NOT NULL,
    inventory_fingerprint CHAR(64) NOT NULL,
    inventory_snapshot   JSONB NOT NULL,
    created_by           INTEGER REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 5. Diagnostic des sources pertinentes (couverture du bilan).
-- ------------------------------------------------------------
CREATE TABLE emission_source_relevance (
    id            SERIAL PRIMARY KEY,
    company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    source_code   VARCHAR(32) NOT NULL,
    status        VARCHAR(24) NOT NULL CHECK (status IN ('pertinente', 'non_pertinente', 'a_evaluer')),
    justification TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, source_code)
);

-- ------------------------------------------------------------
-- 6. Comparaisons sectorielles : métadonnées obligatoires d'une référence.
-- ------------------------------------------------------------
ALTER TABLE sector_benchmarks
    ADD COLUMN reference_year  INTEGER,
    ADD COLUMN territory       VARCHAR(64),
    ADD COLUMN unit            VARCHAR(32),
    ADD COLUMN perimeter       VARCHAR(255),
    ADD COLUMN sample_description VARCHAR(255);

-- ------------------------------------------------------------
-- 7. CBAM : installations, procédés de production, rattachement explicite
--    des données d'activité (jamais une division du bilan global).
-- ------------------------------------------------------------
CREATE TABLE cbam_installations (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    site_id     INTEGER REFERENCES sites(id) ON DELETE SET NULL,
    name        VARCHAR(255) NOT NULL,
    country     VARCHAR(2) NOT NULL DEFAULT 'MA',
    address     VARCHAR(500),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cbam_production_processes (
    id                     SERIAL PRIMARY KEY,
    company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    installation_id        INTEGER NOT NULL REFERENCES cbam_installations(id) ON DELETE CASCADE,
    name                   VARCHAR(255) NOT NULL,
    product_name           VARCHAR(255) NOT NULL,
    cn_code                VARCHAR(10) NOT NULL,
    period_start           DATE NOT NULL,
    period_end             DATE NOT NULL,
    production_tonnes      NUMERIC(18,4) CHECK (production_tonnes IS NULL OR production_tonnes > 0),
    has_precursors         BOOLEAN NOT NULL DEFAULT false,
    produces_multiple_goods BOOLEAN NOT NULL DEFAULT false,
    attribution_note       TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end >= period_start)
);

CREATE TABLE cbam_process_entries (
    process_id        INTEGER NOT NULL REFERENCES cbam_production_processes(id) ON DELETE CASCADE,
    activity_entry_id INTEGER NOT NULL REFERENCES activity_entries(id) ON DELETE CASCADE,
    -- Part de l'émission de la ligne attribuée à ce procédé (règle
    -- d'attribution documentée par l'entreprise dans attribution_note).
    share_pct         NUMERIC(6,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
    PRIMARY KEY (process_id, activity_entry_id)
);

-- Down Migration

DROP TABLE IF EXISTS cbam_process_entries;
DROP TABLE IF EXISTS cbam_production_processes;
DROP TABLE IF EXISTS cbam_installations;
ALTER TABLE sector_benchmarks DROP COLUMN IF EXISTS sample_description, DROP COLUMN IF EXISTS perimeter,
    DROP COLUMN IF EXISTS unit, DROP COLUMN IF EXISTS territory, DROP COLUMN IF EXISTS reference_year;
DROP TABLE IF EXISTS emission_source_relevance;
DROP TABLE IF EXISTS external_assurance_statements;
DROP TABLE IF EXISTS base_year_recalculation_reviews;
DROP TABLE IF EXISTS organizational_boundary_items;
ALTER TABLE companies DROP COLUMN IF EXISTS base_year_policy_notes, DROP COLUMN IF EXISTS base_year_threshold_pct,
    DROP COLUMN IF EXISTS activity_role, DROP COLUMN IF EXISTS boundary_description, DROP COLUMN IF EXISTS consolidation_approach;
DROP TABLE IF EXISTS electricity_contracts;
ALTER TABLE emission_results DROP CONSTRAINT IF EXISTS emission_results_control_status_chk;
UPDATE emission_results SET verification_status = CASE verification_status
    WHEN 'non_controle' THEN 'non_verifie'
    WHEN 'controle_interne_partiel' THEN 'partiellement_verifie'
    WHEN 'controle_interne_effectue' THEN 'totalement_verifie'
    ELSE verification_status END;
ALTER TABLE emission_results ALTER COLUMN verification_status SET DEFAULT 'non_verifie';
ALTER TABLE activity_entries DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS factor_justification,
    DROP COLUMN IF EXISTS purchase_category, DROP COLUMN IF EXISTS distance_km, DROP COLUMN IF EXISTS mass_tonnes,
    DROP COLUMN IF EXISTS amount_mad, DROP COLUMN IF EXISTS scope3_category, DROP COLUMN IF EXISTS internal_control_at,
    DROP COLUMN IF EXISTS internal_control_by, DROP COLUMN IF EXISTS internal_control_note,
    DROP COLUMN IF EXISTS internal_control_status, DROP COLUMN IF EXISTS data_origin;
DROP TABLE IF EXISTS factor_import_rejections;
DROP TABLE IF EXISTS factor_import_batches;
DROP INDEX IF EXISTS idx_emission_factors_uid_version;
ALTER TABLE emission_factors DROP CONSTRAINT IF EXISTS emission_factors_scope3_cat_chk,
    DROP CONSTRAINT IF EXISTS emission_factors_rights_status_chk,
    DROP CONSTRAINT IF EXISTS emission_factors_method_status_chk,
    DROP CONSTRAINT IF EXISTS emission_factors_boundary_chk;
ALTER TABLE emission_factors DROP COLUMN IF EXISTS import_batch_id, DROP COLUMN IF EXISTS scope3_category,
    DROP COLUMN IF EXISTS rights_status, DROP COLUMN IF EXISTS methodological_status, DROP COLUMN IF EXISTS validity_note,
    DROP COLUMN IF EXISTS usage_restrictions, DROP COLUMN IF EXISTS uncertainty_pct, DROP COLUMN IF EXISTS source_cell,
    DROP COLUMN IF EXISTS source_sheet, DROP COLUMN IF EXISTS source_file, DROP COLUMN IF EXISTS source_original,
    DROP COLUMN IF EXISTS boundary, DROP COLUMN IF EXISTS integration_date, DROP COLUMN IF EXISTS publication_date,
    DROP COLUMN IF EXISTS represented_year, DROP COLUMN IF EXISTS technology, DROP COLUMN IF EXISTS geography,
    DROP COLUMN IF EXISTS gwp_reference, DROP COLUMN IF EXISTS gases_covered, DROP COLUMN IF EXISTS activity_label,
    DROP COLUMN IF EXISTS version_label, DROP COLUMN IF EXISTS factor_uid;
