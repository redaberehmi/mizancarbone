-- Première intégration de facteurs nationaux réellement sourcés, obtenus le
-- 2026-10-09 via un expert carbone (fichier "Bilan Carbone Maroc-compatible
-- postes ISO14064 et GHG Protocol — draft 15 octobre 2024", reçu de la FM6 —
-- Fondation Mohammed VI pour l'Environnement).
--
-- SEUL le facteur électricité (Scope 2) est repris dans cette version. Les
-- 4 facteurs de combustion (diesel_L, gasoline_L, lpg_kg, fuel_oil_L) ont
-- été intégrés puis RETIRÉS le même jour : leurs valeurs dans le fichier FM6
-- sont explicitement "amont et combustion" (ex. "Fioul lourd, amont et
-- combustion", source "Base carbone combustion et FM6 amont") -- c'est-à-dire
-- la combustion directe (Scope 1) ADDITIONNÉE à l'amont du carburant
-- (extraction/raffinage/transport, Scope 3 catégorie 3 "Fuel- and
-- energy-related activities", selon le GHG Protocol Corporate Standard).
-- Les injecter telles quelles comme facteur Scope 1 pur aurait gonflé le
-- Scope 1 de 7 à 26% selon le combustible -- et donc la simulation de taxe
-- carbone, calculée sur Scope 1+2. Repéré a posteriori (session du
-- 2026-10-09, relecture croisée avec une analyse indépendante du même
-- fichier) ; le fichier ne fournit pas la décomposition combustion/amont
-- nécessaire pour séparer correctement les deux parts -- aucune estimation
-- inventée pour combler ce manque. À reprendre seulement si l'expert fournit
-- la décomposition, ou confirme explicitement un choix méthodologique
-- "cycle complet en Scope 1" assumé et documenté en annexe méthodologique.
--
-- electricity_ma_location_based_kwh n'est PAS concerné par ce problème : un
-- facteur de mix électrique national (Scope 2) est par construction une
-- valeur "tout compris" par kWh délivré, pas une combustion directe sur site
-- à distinguer d'un amont -- aucune règle GHG Protocol n'exige de séparer
-- l'amont de production électrique du Scope 2 lui-même.
--
-- Choix méthodologique pour l'électricité : NOUVELLE VERSION (nouveau
-- valid_from), pas une correction en place de la ligne 2024 existante --
-- même principe que le test de reversionnement du diesel
-- (calculation.test.js, describe "Sélection du facteur selon la période").
-- Un recalcul sur une période 2024/2025 déjà saisie doit continuer à
-- utiliser la valeur générique qui était en vigueur à cette période ; seules
-- les nouvelles saisies à partir de 2026-01-01 utilisent la valeur sourcée
-- FM6E. Date de bascule choisie au 2026-01-01 (début de l'année en cours au
-- moment de l'intégration), pas de recalcul silencieux de l'historique.
--
-- electricity_ma_location_based_kwh : l'outil FM6 documente aussi un taux de
-- pertes en ligne (12,2%) à appliquer en plus du facteur kWh si on veut
-- refléter l'électricité produite plutôt que seulement consommée au
-- compteur. NON appliqué ici (le moteur de calcul reste sur la consommation
-- déclarée telle quelle) -- décision méthodologique volontairement laissée
-- de côté, à trancher séparément avant toute intégration (même famille de
-- question que ci-dessus : le GHG Protocol range généralement les pertes de
-- transport/distribution électrique en Scope 3, pas en Scope 2, pour un
-- consommateur final).
--
-- Libellé source : texte exact demandé par l'utilisateur le 2026-10-09,
-- repris tel quel (ni raccourci ni reformulé) -- doit apparaître verbatim
-- dans l'annexe méthodologique du PDF (voir reports.service.js /
-- pdf-template.js). "FM6E" = Fondation Mohammed VI pour l'Environnement.
--
-- is_national = false (et non true) : décision explicite de l'utilisateur,
-- pas un oubli -- le fichier source est un brouillon ("draft 15/10/2024")
-- et le droit de réutilisation commerciale des facteurs FM6E n'est pas
-- confirmé. Le badge "à remplacer" (affiché pour is_national=false) reste
-- donc visible dans l'app tant que le statut du fichier et les droits ne
-- sont pas clarifiés auprès de FM6E -- à repasser à true seulement après
-- cette confirmation.

-- Clôture de la version générique 2024 au 2025-12-31 (couvre toutes les
-- périodes déjà utilisées en test/démo), avant insertion de la version FM6E.
UPDATE emission_factors
SET valid_to = '2025-12-31'
WHERE code = 'electricity_ma_location_based_kwh'
  AND valid_from = '2024-01-01'
  AND valid_to IS NULL;

INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from) VALUES
(
    'electricity_ma_location_based_kwh',
    'Électricité réseau national (mix Maroc, location-based)',
    2, 'electricite_location_based', 'kWh', 0.6426,
    'Outil BEGES Maroc (FM6E), mix réseau 2020, version draft du 15/10/2024 — réutilisation commerciale à confirmer',
    false, 'MA', '2026-01-01'
)
ON CONFLICT (code, valid_from) DO NOTHING;
