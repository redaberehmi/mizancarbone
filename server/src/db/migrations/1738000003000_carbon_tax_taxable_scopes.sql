-- Up Migration

-- Le périmètre de scopes soumis à la taxe carbone (Scope 1 seul ? 1+2 ?
-- 1+2+3 ?) n'était spécifié nulle part dans le brief — l'application avait
-- silencieusement fixé "Scope 1 + 2" dans le code applicatif. C'est une
-- hypothèse non confirmée, à traiter comme n'importe quelle donnée non
-- vérifiée (même logique que carbon_tax_parameters.rate_per_tco2e) : jamais
-- figée dans le code, configurable ligne par ligne, versionnée avec le
-- reste des paramètres.
--
-- Pas de valeur par défaut ni NULL : toute ligne insérée dans
-- carbon_tax_parameters doit déclarer explicitement son périmètre taxable —
-- jamais un défaut hérité silencieusement.
ALTER TABLE carbon_tax_parameters ADD COLUMN taxable_scopes SMALLINT[] NOT NULL;

-- Down Migration

ALTER TABLE carbon_tax_parameters DROP COLUMN IF EXISTS taxable_scopes;
