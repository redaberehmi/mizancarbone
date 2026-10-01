-- Up Migration

-- ============================================================
-- Recommandations personnalisées (Module 7, V1.5) — support de tri/texte,
-- pas de nouvelle logique d'éligibilité.
-- ============================================================

-- Distingue les règles du registre par nature : un "critère d'éligibilité"
-- (qui peut candidater) est différent d'une "exclusion" (condition
-- disqualifiante, ex. régularité RC/fiscal/CNSS) — les deux étaient
-- mélangées sans distinction jusqu'ici. 'autre' couvre le reste (taux,
-- prestations nommées, hypothèses de mécanisme...).
ALTER TABLE financing_program_rules ADD COLUMN rule_type VARCHAR(24) NOT NULL DEFAULT 'autre'
    CHECK (rule_type IN ('critere_eligibilite', 'exclusion', 'autre'));

-- Édition/période en cours — distinct de deadline_note (qui explique la
-- situation générale) : ce champ est prévu pour tenir à jour QUELLE édition
-- est actuellement ouverte (ex. "Édition 2026"), mais reste NULL tant qu'on
-- n'a pas une confirmation fraîche — la dernière info connue pour Tatwir
-- (édition 2022) est trop ancienne pour être présentée comme actuelle.
ALTER TABLE financing_programs ADD COLUMN current_edition_label VARCHAR(128);

-- Repli explicite pour le libellé "Éligibilité non déterminée" quand la
-- raison n'est pas une simple donnée manquante de routine, mais un doute
-- plus large sur la fiabilité du dispositif lui-même (ex. PACT'Décarbonation/
-- Eau : contradiction de plafond + risque de refonte du programme). Prime
-- sur le message générique quand renseigné.
ALTER TABLE financing_programs ADD COLUMN size_undetermined_reason TEXT;

-- Down Migration

ALTER TABLE financing_programs DROP COLUMN IF EXISTS size_undetermined_reason;
ALTER TABLE financing_programs DROP COLUMN IF EXISTS current_edition_label;
ALTER TABLE financing_program_rules DROP COLUMN IF EXISTS rule_type;
