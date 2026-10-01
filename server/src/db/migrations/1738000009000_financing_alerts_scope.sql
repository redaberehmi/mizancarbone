-- Up Migration

-- ============================================================
-- Cadrage explicite (V1.5) : "alertes nouveaux programmes" et "suivi des
-- échéances" restent limités aux dispositifs déjà dans le registre
-- (financing_program_rules) ET jugés suffisamment fiables dans leur
-- ensemble — PAS une règle mécanique du type "aucune ligne non confirmée
-- dans le registre" (Tatwir a lui-même une hypothèse non confirmée -
-- bfr_aid_hypothesis - et reste pourtant éligible aux alertes : la
-- contradiction trouvée sur PACT'Décarbonation/Eau porte sur un FAIT
-- STRUCTURANT — le plafond lui-même, 1 MDH vs 2 MDH — et un possible
-- changement de cadre entier, pas une hypothèse secondaire).
--
-- alerts_eligible est donc un choix délibéré, jamais dérivé automatiquement
-- du statut des règles — défaut à false : un programme doit être activé
-- explicitement pour générer le badge "Nouveau".
--
-- Explicitement hors-scope V1.5 (reporté en V2, avec prérequis) : toute
-- détection automatisée de nouveaux programmes par veille/scraping externe.
-- Aucune structure ajoutée pour ça ici, contrairement à d'autres tables
-- "prêtes mais vides" du projet — cette fonctionnalité entière attend un
-- partenariat institutionnel ou une vérification humaine dédiée.
-- ============================================================
ALTER TABLE financing_programs ADD COLUMN alerts_eligible BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- Échéances — structure prête, aucun mécanisme de rappel (30j/7j avant...)
-- tant qu'aucune vraie échéance n'existe dans le registre. application_deadline
-- pour une vraie date fixe une fois confirmée ; deadline_note pour décrire
-- une cadence qui n'est pas une date unique (ex. "fonctionne par éditions
-- successives, pas de date récurrente confirmée").
-- ============================================================
ALTER TABLE financing_programs ADD COLUMN application_deadline DATE;
ALTER TABLE financing_programs ADD COLUMN deadline_note TEXT;

-- Down Migration

ALTER TABLE financing_programs DROP COLUMN IF EXISTS deadline_note;
ALTER TABLE financing_programs DROP COLUMN IF EXISTS application_deadline;
ALTER TABLE financing_programs DROP COLUMN IF EXISTS alerts_eligible;
