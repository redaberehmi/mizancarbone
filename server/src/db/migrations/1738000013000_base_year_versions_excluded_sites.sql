-- Up Migration

-- ============================================================
-- Complément idempotent : une base où base_year_inventory_versions a été
-- créée par une version intermédiaire (sans excluded_site_ids) reçoit la
-- colonne ; sans effet si elle existe déjà.
-- ============================================================
ALTER TABLE base_year_inventory_versions
    ADD COLUMN IF NOT EXISTS excluded_site_ids INTEGER[] NOT NULL DEFAULT '{}';

-- Exclusions partielles (équipement, opération, actif loué) qui n'ont pas
-- pu être appliquées automatiquement aux données lors du recalcul.
ALTER TABLE base_year_inventory_versions
    ADD COLUMN IF NOT EXISTS partial_exclusions JSONB NOT NULL DEFAULT '[]';

-- Down Migration

ALTER TABLE base_year_inventory_versions DROP COLUMN IF EXISTS partial_exclusions;
