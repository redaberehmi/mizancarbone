-- Up Migration

-- ============================================================
-- Bug trouvé en vérification manuelle : UNIQUE(financing_program_id, label,
-- beneficiary_type) ne protège PAS contre les doublons quand
-- beneficiary_type est NULL — en SQL standard, NULL n'est jamais égal à
-- NULL, même sous une contrainte UNIQUE, donc "ON CONFLICT (..., beneficiary_type)
-- DO NOTHING" ne se déclenche jamais pour les volets sans distinction
-- PME/TPE (ex. "Investissement"). Confirmé en conditions réelles : ré-exécuter
-- le seed a dupliqué la ligne "Investissement" de Tatwir Croissance Verte.
--
-- Corrigé par un index unique sur une expression qui normalise NULL en
-- chaîne vide pour la comparaison — deux volets sans beneficiary_type sont
-- alors bien détectés comme un doublon.
-- ============================================================

-- Supprime les doublons déjà créés par ce bug, garde la ligne la plus ancienne.
DELETE FROM financing_program_components a
USING financing_program_components b
WHERE a.id > b.id
  AND a.financing_program_id = b.financing_program_id
  AND a.label = b.label
  AND a.beneficiary_type IS NOT DISTINCT FROM b.beneficiary_type;

ALTER TABLE financing_program_components DROP CONSTRAINT IF EXISTS financing_program_components_financing_program_id_label_ben_key;

CREATE UNIQUE INDEX financing_program_components_unique_idx
    ON financing_program_components (financing_program_id, label, (COALESCE(beneficiary_type, '')));

-- Down Migration

DROP INDEX IF EXISTS financing_program_components_unique_idx;
ALTER TABLE financing_program_components ADD CONSTRAINT financing_program_components_financing_program_id_label_ben_key
    UNIQUE (financing_program_id, label, beneficiary_type);
