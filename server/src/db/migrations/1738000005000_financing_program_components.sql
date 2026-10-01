-- Up Migration

-- ============================================================
-- Module 7 (V1.5) — un dispositif de financement peut combiner plusieurs
-- volets de financement (mécanismes de prise en charge, taux différents)
-- et couvrir plusieurs catégories de projets éligibles, indépendamment les
-- unes des autres. Exemple confirmé (Tatwir Croissance Verte, source
-- mcinet.gov.ma) : le volet "investissement" (30%) et le volet "conseil et
-- expertise technique" (80% PME / 90% TPE) sont deux mécanismes séparés,
-- pas un taux par catégorie de projet — un même projet peut mobiliser
-- plusieurs volets à la fois. L'ancienne colonne financing_programs.subsidy_rate
-- supposait un taux unique par programme, ce qui ne représente pas cette
-- réalité — remplacée par une table dédiée.
-- ============================================================

CREATE TABLE financing_program_components (
    id                      SERIAL PRIMARY KEY,
    financing_program_id    INTEGER NOT NULL REFERENCES financing_programs(id) ON DELETE CASCADE,
    label                   VARCHAR(255) NOT NULL,   -- ex: 'Investissement', 'Conseil et expertise technique'
    beneficiary_type        VARCHAR(16),             -- 'PME' | 'TPE' | NULL si le taux ne distingue pas les deux
    subsidy_rate_pct        NUMERIC(5,2),            -- NULL tant que non confirmé (ex: volet innovation) — jamais une valeur estimée
    cap_amount_mad          NUMERIC(14,2),
    notes                   TEXT,                    -- ex: hypothèse à vérifier sur un sous-mécanisme (apport fonds propres...)
    source                  VARCHAR(255) NOT NULL,
    active                  BOOLEAN NOT NULL DEFAULT true, -- false = structurellement présent mais pas encore confirmé, jamais affiché comme si ça l'était
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (financing_program_id, label, beneficiary_type)
);
CREATE INDEX idx_financing_program_components_program ON financing_program_components (financing_program_id);

CREATE TABLE financing_program_categories (
    id                      SERIAL PRIMARY KEY,
    financing_program_id    INTEGER NOT NULL REFERENCES financing_programs(id) ON DELETE CASCADE,
    label                   VARCHAR(255) NOT NULL,   -- ex: 'Transition énergétique', 'Filières vertes'
    UNIQUE (financing_program_id, label)
);

-- Le taux ne vit plus sur financing_programs — un même programme peut avoir
-- zéro, un ou plusieurs volets, jamais un taux unique supposé s'appliquer
-- à tout.
ALTER TABLE financing_programs DROP COLUMN IF EXISTS subsidy_rate;
ALTER TABLE financing_programs DROP COLUMN IF EXISTS cap_amount_mad;

-- Nécessaire pour pouvoir seeder financing_programs de façon idempotente
-- (ON CONFLICT (name) DO NOTHING), comme le reste des tables de référence.
ALTER TABLE financing_programs ADD CONSTRAINT financing_programs_name_key UNIQUE (name);

-- Down Migration

ALTER TABLE financing_programs DROP CONSTRAINT IF EXISTS financing_programs_name_key;
ALTER TABLE financing_programs ADD COLUMN subsidy_rate NUMERIC(5,2);
ALTER TABLE financing_programs ADD COLUMN cap_amount_mad NUMERIC(14,2);
DROP TABLE IF EXISTS financing_program_categories;
DROP TABLE IF EXISTS financing_program_components;
