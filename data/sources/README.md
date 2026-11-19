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
- **Statut** : version « draft » du 15/10/2024 (nom du fichier). Le
  17/11/2026, l'experte carbone (contact FM6) a indiqué que c'est le fichier
  actuellement utilisé et qu'il n'existe pas de version actualisée. Le nom et
  la version exacts sont conservés : ce n'est pas une édition officiellement
  publiée. Les onglets de synthèse contiennent des erreurs `#REF!` non
  corrigées (sans effet sur les tableaux de facteurs repris).
- **Droits de réutilisation commerciale** : **non confirmés**. Question
  posée directement à FM6E par l'utilisateur (en cours). Bloquant avant tout
  déploiement ou pilote client, pas bloquant pour un usage local de
  développement/test.
- **Import reproductible (2026-11-18)** : `server/src/db/import/fm6e-import.js`
  lit le classeur, classe chaque ligne (règles dans `fm6e-registry.js`) et
  produit un rapport (`data/sources/fm6e-import-report.json`, exclu de git).
  Mode aperçu par défaut ; `--apply` pour écrire dans la base pointée par
  `DATABASE_URL`. Ne jamais l'appliquer à la base de production tant que les
  droits ne sont pas confirmés. Résultat sur ce fichier : 306 facteurs
  retenus, 47 écartés (dont 21 « combustion + amont » non décomposés,
  inutilisables pour le Scope 1 ; 6 facteurs électriques de cycle de vie
  non admissibles en market-based ; 7 de périmètre non indiqué ; 4 sans
  source ; 2 « estimé » ; 2 paramétriques ; 5 hydrogène hors combustion).
  Un réimport du même fichier ne crée aucun doublon et n'écrase jamais une
  valeur existante.
- **Utilisation historique dans le code** : un seul facteur en a été extrait et
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
