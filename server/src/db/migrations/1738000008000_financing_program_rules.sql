-- Up Migration

-- ============================================================
-- Correction méthodologique : la classification TPE/PME/GE pour
-- l'éligibilité à un dispositif n'est pas universellement la Charte de la
-- PME (Loi 53-00) — Tatwir Croissance Verte utilise son propre critère
-- (CA annuel HT uniquement, seuils différents), confirmé indépendamment via
-- 3 sources convergentes. Le critère légal générique (Loi 53-00,
-- financing.service.js : computeCompanySizeCategory) reste valide comme
-- repli pour un programme qui n'a pas encore de critère propre confirmé —
-- jamais supposé identique par défaut.
--
-- eligible_size_categories devient NULLABLE : NULL = critère pas encore
-- déterminé pour ce programme (jamais assimilé à "tout le monde éligible"
-- ni à "personne éligible" — l'éligibilité reste explicitement indéterminée
-- tant que la donnée manque, même discipline que le reste du projet).
-- ============================================================
ALTER TABLE financing_programs ALTER COLUMN eligible_size_categories DROP NOT NULL;

-- Seuils de taille propres à CE programme (CA en MAD) — NULL sur les deux
-- colonnes = pas de critère programme confirmé, on retombe sur la Loi 53-00.
ALTER TABLE financing_programs ADD COLUMN tpe_max_ca_mad NUMERIC(14,2);
ALTER TABLE financing_programs ADD COLUMN pme_max_ca_mad NUMERIC(14,2);
ALTER TABLE financing_programs ADD COLUMN size_rule_source TEXT;

-- Conditions que l'application ne peut pas tester automatiquement (aucune
-- donnée collectée pour ça) — affichées comme rappel, jamais simulées.
ALTER TABLE financing_programs ADD COLUMN non_automated_conditions TEXT;

-- ============================================================
-- Registre officiel des règles de financement — traçabilité de CHAQUE fait
-- (seuil, taux, condition, service nommé...) avec sa source exacte, qui l'a
-- vérifié, quand, et son statut. Sert notamment le jour où deux sources se
-- contredisent légèrement (déjà arrivé : pourcentage exact de l'aide BFR).
-- ============================================================
CREATE TABLE financing_program_rules (
    id                      SERIAL PRIMARY KEY,
    financing_program_id    INTEGER NOT NULL REFERENCES financing_programs(id) ON DELETE CASCADE,
    rule_key                VARCHAR(64) NOT NULL,
    rule_label              VARCHAR(255) NOT NULL,
    rule_detail             TEXT NOT NULL,
    primary_source          TEXT NOT NULL,
    verified_at             DATE NOT NULL,
    verified_by             VARCHAR(16) NOT NULL CHECK (verified_by IN ('utilisateur', 'recherche_ia', 'claude_code')),
    status                  VARCHAR(16) NOT NULL CHECK (status IN ('confirme', 'a_confirmer', 'non_confirme')),
    expires_at              DATE,
    UNIQUE (financing_program_id, rule_key)
);

-- Down Migration

DROP TABLE IF EXISTS financing_program_rules;
ALTER TABLE financing_programs DROP COLUMN IF EXISTS non_automated_conditions;
ALTER TABLE financing_programs DROP COLUMN IF EXISTS size_rule_source;
ALTER TABLE financing_programs DROP COLUMN IF EXISTS pme_max_ca_mad;
ALTER TABLE financing_programs DROP COLUMN IF EXISTS tpe_max_ca_mad;
-- Ne remet pas NOT NULL sur eligible_size_categories en rollback : on ne
-- connaît pas les valeurs qui existaient avant, mieux vaut échouer visible
-- que réinsérer une valeur devinée.
