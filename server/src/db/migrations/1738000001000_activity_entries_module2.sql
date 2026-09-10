-- Up Migration

-- Module 2 (collecte de données) : deux ajouts additifs, ne modifient aucune
-- colonne existante et ne cassent pas le schéma V1 initial.

-- 1. "matières premières (quantité + fournisseur)" — factor_code reste
--    NOT NULL (schéma d'origine respecté) mais n'a pas de facteur d'émission
--    réel pour les matières premières (le Scope 3 est calculé au Module 3
--    via un ratio sectoriel global, pas ligne par ligne). Ces deux colonnes
--    ne sont renseignées que pour les entrées "matière première" ; le
--    factor_code utilisé pour ces lignes est un code sentinelle
--    ('matiere_premiere_non_calculee') qui ne correspond à aucune ligne de
--    emission_factors — voir src/modules/activity-entries/constants.js.
ALTER TABLE activity_entries ADD COLUMN supplier VARCHAR(255);
ALTER TABLE activity_entries ADD COLUMN material_label VARCHAR(255);

-- 2. Exigence section 7.8 : jamais de suppression physique d'activity_entries,
--    soft delete à privilégier. La colonne n'existait pas dans le schéma
--    initial ; ajoutée pour pouvoir réellement appliquer cette exigence.
ALTER TABLE activity_entries ADD COLUMN deleted_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE activity_entries DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE activity_entries DROP COLUMN IF EXISTS material_label;
ALTER TABLE activity_entries DROP COLUMN IF EXISTS supplier;
