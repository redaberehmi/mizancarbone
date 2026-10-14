# Fichiers sources tiers — statut et droits à clarifier

Ce dossier reçoit des fichiers de données externes (facteurs d'émission,
référentiels) utilisés pour analyse ou intégration ponctuelle dans
MizanCarbone, **dont le statut ou les droits de réutilisation commerciale ne
sont pas encore confirmés**. Son contenu est exclu de git (`.gitignore`) à
l'exception de ce README — ne jamais commiter les fichiers eux-mêmes tant que
la clarification ci-dessous n'est pas faite.

## Fichiers reçus

### Bilan Carbone Maroc-compatible postes ISO14064 et GHG Protocol-draft-15 octobre 2024.xlsx

- **Provenance** : reçu via un expert carbone, lui-même obtenu auprès de la
  FM6E (Fondation Mohammed VI pour l'Environnement).
- **Date du fichier** : draft du 15 octobre 2024 (date dans le nom du
  fichier lui-même).
- **Date de réception** : 2026-10-09.
- **Statut** : **brouillon non confirmé**. Le nom du fichier porte
  explicitement la mention "draft", et les onglets de synthèse contiennent
  des erreurs `#REF!` non corrigées. Aucune version finale identifiée à ce
  jour.
- **Droits de réutilisation commerciale** : **non confirmés**. Question
  posée directement à FM6E par l'utilisateur (en cours). Bloquant avant tout
  déploiement ou pilote client, pas bloquant pour un usage local de
  développement/test.
- **Utilisation actuelle dans le code** : un seul facteur en a été extrait et
  intégré à `server/src/db/seed/007_emission_factors_fm6_national.sql`
  (électricité réseau national Maroc, mix 2020, 0,6426 kgCO2e/kWh), marqué
  `is_national = false` tant que ce statut n'est pas clarifié — voir les
  commentaires de ce fichier de seed pour le détail. Les autres facteurs du
  fichier (combustibles, matières premières, gaz réfrigérants, ratio Scope 3
  tertiaire) ne sont **pas** intégrés : voir la discussion dans l'historique
  du projet (points 4 et 5 du plan de financement/facteurs, en attente de la
  décomposition combustion/amont par l'expert).
- **Décision à valider par l'expert carbone** : le facteur FM6E (mix 2020)
  n'est appliqué qu'à partir du 01/01/2026 ; les périodes 2024–2025 restent
  sur 0,644 générique. Effet sur la comparaison avec l'année de référence à
  évaluer (recalcul éventuel, GHG Protocol).

## Règle pour tout nouveau fichier ajouté ici

Ajouter une section ci-dessus avec : nom exact du fichier, provenance, date
du fichier, date de réception, statut (brouillon/final), droits de
réutilisation (confirmés/à confirmer/refusés), et un pointeur vers où/comment
il a été utilisé dans le code le cas échéant.
