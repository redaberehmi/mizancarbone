-- Désactive les 6 facteurs de production électrique (market-based) ajoutés
-- par le seed 008, en attendant la correction du calcul market-based.
--
-- Problème identifié le 2026-10-15 (calculation.service.js,
-- getEmissionsSummary) : dès qu'une entrée référence un facteur
-- "electricite_market_based", le Scope 2 market-based ne compte QUE ces
-- entrées — le reste de la consommation réseau n'y figure plus — et les kWh
-- sous contrat manquent au location-based. En situation mixte, les deux
-- totaux sont incomplets. Méthode cible (à valider par l'expert) : une seule
-- saisie de consommation, la part sous contrat, et un facteur pour le reste.
--
-- Même mécanisme que les placeholders Scope 3 (seed 003) : valid_to =
-- valid_from rend la ligne invisible dans la liste de saisie (filtre
-- valid_to IS NULL) et inutilisable pour toute période réelle. Les lignes
-- restent en base, avec leur source, pour être réactivées une fois le calcul
-- corrigé. Aucune donnée en ligne ne les utilisait au moment de la
-- désactivation (vérifié sur la base de production).
UPDATE emission_factors
SET valid_to = valid_from
WHERE category = 'electricite_market_based'
  AND code LIKE 'electricity_production_%'
  AND valid_to IS NULL;
