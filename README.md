# MizanCarbone

Plateforme de préparation de données carbone pour PME/ETI exportatrices marocaines.
C'est un outil de **préparation interne** (collecte, calcul, structuration) — jamais un outil
de déclaration ou de soumission à un registre officiel. Voir le vocabulaire verrouillé dans le
brief produit avant toute modification de libellé.

## Structure

- `server/` — API Node.js/Express, PostgreSQL
- `client/` — Interface React + Tailwind CSS

## Mise en route

### 1. Base de données

```bash
createdb mizancarbone
```

### 2. Backend

```bash
cd server
cp .env.example .env   # renseigner DATABASE_URL et JWT_SECRET
npm install
npm run migrate:up     # applique le schéma (server/src/db/migrations)
npm run seed            # insère les facteurs d'émission génériques (non nationaux)
npm run dev              # http://localhost:4000
```

### 3. Frontend

```bash
cd client
npm install
npm run dev              # http://localhost:5173 (proxy /api -> :4000)
```

### 4. Tests backend

```bash
cd server
npm test
```

Aucune installation PostgreSQL locale n'est nécessaire pour les tests : `npm test`
démarre automatiquement un PostgreSQL embarqué (`embedded-postgres`, devDependency
signalée — jamais utilisée en production), applique le schéma, exécute la suite,
puis l'arrête. Voir `tests/globalSetup.js`.

**91/91 tests passent**, y compris `tests/tenant-isolation.test.js` qui vérifie
qu'une entreprise B ne peut ni lire, modifier, ni supprimer un site, un profil,
une donnée d'activité, ou un résultat de calcul appartenant à une entreprise A,
même en devinant un ID (exigence section 7.1).

> Note Windows : dans de rares cas, un test interrompu brutalement (Ctrl+C,
> crash) peut laisser un processus `postgres.exe` orphelin qui bloque le port
> 54329 au run suivant. Si `npm test` échoue avec "address already in use",
> fermez-le manuellement via le Gestionnaire des tâches (ne pas tuer tous les
> processus `postgres` sans vérifier — cela couperait aussi un PostgreSQL de
> développement réel si vous en avez un qui tourne).

## État d'avancement

| Module | Statut |
|---|---|
| 1. Authentification & entreprise | Backend + frontend livrés, tests passent (dont isolation multi-tenant) |
| 2. Collecte de données | Backend + frontend livrés (saisie manuelle + import CSV/Excel), tests passent |
| 3. Moteur de calcul carbone | Scope 1/2 opérationnels (calcul auto). Scope 3 spend-based prêt structurellement, données ADEME/taux de change non fournies (voir écarts) |
| 4. Préparation de données CBAM | Backend + frontend livrés (export CSV/PDF, vocabulaire verrouillé testé), tests passent |
| 5. Veille financements & taxe carbone | Backend + frontend livrés (états vides soignés), tables prêtes mais vides (voir écarts), tests passent |
| 6. Rapports & tableau de bord | Backend + frontend livrés (tableau de bord avec graphiques, export CSV brut, export PDF avec annexe méthodologie/facteurs), tests passent — **V1 complète** |

## Écarts par rapport au brief (Module 1)

- **Sessions** : implémentées en JWT signé stocké dans un cookie `httpOnly`
  (plutôt que `localStorage`), pour réduire l'exposition aux attaques XSS. Le
  brief autorisait explicitement "sessions ou JWT".
- **Changement d'année de référence** : la règle appliquée est "raison
  obligatoire dès que `base_year` était déjà renseigné et change", plutôt que
  strictement "après la première saisie de données" (module 2 pas encore
  livré, donc pas encore de données d'activité à tester). À revalider une
  fois le module 2 en place.
- **`financing_programs` / `carbon_tax_parameters`** : aucune donnée n'a été
  pré-remplie (pas de subventions/taux fabriqués) — ces tables restent vides
  jusqu'à ce que des chiffres officiels vérifiés soient fournis (module 5).
- **`embedded-postgres`** ajouté en devDependency (voir section Tests) pour
  pouvoir exécuter réellement la suite de tests sans PostgreSQL local.

## Bugs trouvés et corrigés en exécutant les tests

- Le rate limiter d'authentification (`limit: 10` / 15 min, section 7.4) était
  codé en dur et se déclenchait pendant la suite de tests elle-même (plusieurs
  `register`/`login` légitimes sur la même IP dans un même fichier de test),
  faisant échouer des tests fonctionnels avec un 429 au lieu du code attendu.
  Corrigé en rendant la limite configurable via `AUTH_RATE_LIMIT_MAX` (défaut
  production inchangé : 10 ; relevée uniquement dans l'environnement de test).
- Nettoyage du Postgres embarqué instable sous Windows (`EBUSY` sur le dossier
  de données juste après l'arrêt du process) — corrigé en gardant les données
  persistantes le temps du run plutôt que de les supprimer immédiatement.

Trouvés ensuite en pilotant l'app dans un vrai navigateur (register → profil →
changement d'année de référence → logout/login) :

- **`npm run migrate:up` ne trouvait aucune migration.** `node-pg-migrate` v7
  ne lit pas automatiquement un fichier `.node-pg-migraterc.json` — il n'a pas
  de convention de type "rc file" ; il faut lui passer les options en ligne de
  commande (ou `--config-file` explicitement). Le fichier rc créé initialement
  n'était donc jamais lu, et la commande cherchait ses migrations dans
  `migrations/` (dossier inexistant) au lieu de `src/db/migrations`. Corrigé
  en supprimant ce fichier inutile et en mettant les flags directement dans
  les scripts `package.json` (`-m src/db/migrations --migration-file-language sql`).
- **`GET/PUT /api/companies/me` renvoyaient les champs en `snake_case`**
  (`base_year`) alors que tout le frontend lit du camelCase (`baseYear`),
  comme le fait déjà correctement `GET /api/auth/me`. Conséquence concrète :
  après un premier enregistrement de l'année de référence, la page perdait la
  valeur précédente et ne déclenchait plus l'exigence de raison obligatoire
  au changement suivant — une régression sur une exigence de sécurité/
  traçabilité du brief (section 5). Corrigé en sérialisant la réponse en
  camelCase dans `companies.controller.js`.

Ces deux bugs n'étaient couverts par aucun test automatisé existant (les tests
appellent directement le service SQL de migration, pas la CLI ; et aucun test
ne vérifiait la casse des clés JSON). Vérifié ensuite de bout en bout avec
Playwright (register, ajout de site, premier `base_year`, tentative de
changement sans raison → bloquée, changement avec raison → acceptée, logout,
re-login → données bien persistées). Aucune erreur console autre que les 401
attendus de `/api/auth/me` sur les pages non authentifiées.

## Écarts par rapport au brief (Module 2)

- **"Matières premières (quantité + fournisseur)"** : décision prise avec
  l'utilisateur (le brief crée une contradiction sinon — `factor_code` est
  `NOT NULL` mais aucun facteur d'émission par matière première n'est fourni,
  et le Module 3 calcule le Scope 3 par un ratio sectoriel global, pas ligne
  par ligne). Ces entrées sont stockées comme donnée de traçabilité (utile au
  Module 4 CBAM) avec un `factor_code` sentinelle
  (`matiere_premiere_non_calculee`, ne correspond à aucune ligne
  `emission_factors` — jamais de valeur d'émission inventée). Voir
  `src/modules/activity-entries/constants.js`.
- **Schéma étendu (additif, migration séparée)** : `activity_entries.supplier`
  et `.material_label` (pour la donnée ci-dessus) + `.deleted_at` (soft delete,
  colonne absente du schéma initial mais exigée par la section 7.8 — jamais de
  suppression physique d'`activity_entries`). Aucune colonne existante modifiée.
- **Pas d'endpoint de modification** des entrées (seulement création + soft
  delete) : non demandé explicitement, et cohérent avec l'exigence de
  traçabilité (une correction se fait en retirant puis ressaisissant, avec
  trace de la suppression).
- **Site obligatoire** en saisie manuelle comme en import (le schéma autorise
  `site_id NULL`, mais "organisation par site" est un principe central du
  module) ; si l'entreprise n'a aucun site, la page invite à en créer un
  d'abord (Module 1).

## Bugs trouvés et corrigés (Module 2)

Trouvés par les tests automatisés (avant tout passage navigateur) :

- **SheetJS convertit silencieusement les dates ISO en numéro de série
  Excel**, même pour un fichier CSV texte brut (`"2024-01-01"` devenait
  `45292.04...`). Corrigé en passant `raw: true` à `XLSX.read()` et à
  `sheet_to_json()`, ce qui conserve le texte brut des cellules CSV.
- **`file-type` levait une exception non gérée** (`EndOfStreamError`) sur un
  buffer trop court au lieu de renvoyer "type inconnu", provoquant un 500 au
  lieu d'un 400 propre sur un petit fichier rejeté. Corrigé par un try/catch
  qui traite l'échec de détection comme "type non reconnu".

Trouvé en pilotant l'app dans un vrai navigateur (saisie énergie, saisie
matière première, import CSV valide et invalide) :

- **Décalage d'affichage des dates de période** (`2024-01-01` affiché comme
  `2023-12-31T23:00:00.000Z`) : `node-postgres` convertit les colonnes `DATE`
  en objets `Date` JS à minuit *local*, que `res.json()` sérialise ensuite en
  UTC — au Maroc (UTC+1), ça décale visiblement toutes les dates d'un jour.
  Corrigé une fois pour toutes au niveau du pool (`config/db.js`,
  `types.setTypeParser` sur l'OID 1082) pour que toute colonne `DATE`, dans ce
  module comme dans les suivants, revienne en simple texte `AAAA-MM-JJ`.
- **Le rapport d'erreurs d'import CSV ne s'affichait jamais dans l'interface**
  : le contrôleur renvoyait les erreurs sous `rowErrors` au niveau racine du
  JSON, mais le client API (`ApiError.details`) et la page ne lisaient que
  `details` (le contrat suivi partout ailleurs dans l'API). L'utilisateur
  voyait un message générique au lieu de la ligne et du champ fautifs.
  Corrigé en alignant le contrôleur sur `details`.

Aucun de ces trois derniers bugs n'était détectable par les tests d'intégration
existants (qui appellent l'API directement et vérifiaient la forme de réponse
qu'ils venaient d'écrire, pas le rendu réel côté client). Après correction,
suite complète re-vérifiée en navigateur : formulaire énergie, formulaire
matière première, tableau des entrées (avec badge "générique" sur les facteurs
non nationaux), import CSV réussi et import CSV en erreur avec message précis.

## Module 3 — mécanisme de calcul

- **Scope 1 & 2** : calcul automatique et immédiat dès la création d'une
  entrée énergie (Module 2) — `quantity × emission_factors.value_kgco2e`,
  résultat inséré dans `emission_results` avec la version exacte du facteur
  utilisée. Idempotent : `POST /api/calculations/run` ne calcule que les
  entrées qui n'ont pas encore de résultat, ne recalcule jamais un résultat
  existant (jamais de recalcul silencieux si un facteur est reversionné).
- **Scope 2 double reporting** : location-based calculé depuis les entrées
  réelles ; market-based reflète le même total par défaut (aucun contrat
  d'énergie spécifique — non développé, conformément au brief), mais bascule
  automatiquement dès qu'un facteur `electricite_market_based` réel existe.
- **Scope 3 spend-based** (GHG Protocol Technical Guidance, ratios monétaires
  ADEME Base Empreinte, kgCO2e/k€) : `montant (k€) × ratio sectoriel`.
  Implémenté avec :
  - `sector_naf_mapping` — table explicite secteur → code NAF (voir seed
    `002_sector_naf_mapping.sql`, codes divisions NAF rév.2 réels, à affiner
    vers la sous-catégorie Base Empreinte exacte).
  - `exchange_rates` — table versionnée (comme `emission_factors`) pour tracer
    le taux EUR/MAD utilisé à chaque calcul. **Vide en V1** : aucun taux inventé.
  - Les 4 lignes `scope3_ratio_<secteur>` dans `emission_factors` sont des
    **placeholders structurels inactifs** (`valid_to = valid_from`, donc
    jamais sélectionnées par la logique "facteur courant" utilisée partout
    ailleurs) — **aucune valeur numérique inventée**. Pour activer un secteur :
    insérer une nouvelle ligne avec le même code, la valeur réelle consultée
    dans la Base Empreinte, `valid_from = aujourd'hui`, `valid_to = NULL`
    (exactement le geste déjà utilisé pour versionner n'importe quel facteur).
  - Incertitude ADEME (30–80 %) affichée explicitement à côté de tout résultat
    Scope 3 concerné, dans l'UI (jamais en note de bas de page) — constante
    `SCOPE3_RATIO_UNCERTAINTY`, à reprendre telle quelle dans le PDF (Module 6).
  - **Tant qu'aucun secteur n'est activé et qu'aucun taux n'est configuré,
    `POST /api/calculations/scope3/estimate` renvoie 422 avec le détail de ce
    qui manque** — jamais un calcul silencieux à partir de données absentes.
    Vérifié en navigateur dans les deux états (indisponible, puis avec des
    valeurs de test insérées manuellement pour valider l'affichage — ces
    valeurs de test n'ont pas été conservées dans le seed).
- **Agrégation par site, par période et par produit** (`GET /api/calculations/summary`
  renvoie `bySite`, `byPeriod`, `byProduct`) — le regroupement par produit
  retombe entièrement sous « Non alloué » tant que le Module 4 (CBAM) ne
  renseigne pas `activity_entries.product_allocation` ; le mécanisme est prêt,
  conforme au "si allocation renseignée" du brief.

## Points vérifiés suite à relecture (avant validation du Module 3)

Trois questions de contrôle ont mis en évidence deux trous réels, corrigés :

1. **`base_year_recalculations`** : la logique était bien implémentée depuis le
   Module 1, mais **jamais couverte par un test automatisé** — seulement
   vérifiée visuellement une fois via Playwright. Ajouté : `tests/companies.test.js`
   (4 tests — premier réglage sans raison, changement refusé sans raison,
   changement accepté avec raison + trace en base, aucune trace si la valeur
   ne change pas réellement).
2. **Agrégation par période et par produit** : absente du Module 3 tel que
   livré initialement (seul le site était agrégé), alors que c'est une ligne
   explicite du brief. Ajoutée (voir ci-dessus), avec tests et vérification
   navigateur.
3. **Sélection du facteur courant — `valid_to IS NULL` seul était insuffisant,
   corrigé.** Ma première réponse (confirmant que `valid_to IS NULL` exclut
   bien les placeholders) était correcte mais incomplète : elle ne traitait
   que le risque "sélectionner un placeholder par erreur", pas le risque plus
   important soulevé ensuite — sélectionner la **mauvaise version réelle**
   d'un facteur reversionné. Voir "Bug critique" ci-dessous.

## Bug critique trouvé et corrigé (Module 3) — sélection du facteur par période

**Symptôme potentiel évité** : si un facteur d'émission est reversionné (une
nouvelle valeur est ajoutée, l'ancienne reçoit un `valid_to`), tout recalcul
portant sur une **période passée** — recalcul différé (`POST /calculations/run`
sur une donnée historique) ou simple saisie rétroactive — sélectionnait la
requête `WHERE valid_to IS NULL` sans jamais comparer `valid_from`/`valid_to`
du facteur à `period_start`/`period_end` de l'entrée. Résultat : la **version
la plus récente** du facteur (pas celle en vigueur à l'époque des faits)
aurait été appliquée à une donnée passée — l'inverse exact de ce qu'une table
de facteurs versionnée est censée garantir.

**Corrigé** dans `activity-entries.service.js` et `calculation.service.js` :
toute sélection de facteur ou de taux de change compare désormais
`valid_from <= period_start AND (valid_to IS NULL OR valid_to >= period_end)`
— le facteur doit couvrir l'intégralité de la période de l'entrée, pas
seulement être "actuellement actif". S'applique à la fois aux facteurs
Scope 1/2 et au ratio/taux de change Scope 3. Le seul endroit qui garde une
logique "aujourd'hui" est l'indicateur de disponibilité Scope 3
(`getScope3Readiness`, affiché avant que l'utilisateur ait choisi une
période) — un simple indice UI, pas le calcul réel.

**8 tests ajoutés** (`tests/calculation.test.js`, describe "Sélection du
facteur selon la période") reproduisant le scénario exact : reversionnement
du facteur diesel + backfill d'une entrée historique (doit utiliser
l'ancienne valeur), saisie en temps réel sur une période récente (doit
utiliser la nouvelle), saisie sur une période sans aucune version valide
(doit être refusée, 400) ; et l'équivalent côté Scope 3 (ratio **et** taux de
change versionnés séparément, une estimation sur une période passée doit
utiliser les deux valeurs d'époque, pas les plus récentes).

### Cas limite : la période traverse un changement de version (ni ancienne ni
### nouvelle version ne couvre toute la période)

Question de contrôle supplémentaire : que se passe-t-il si une période
chevauche deux versions contiguës d'un même facteur (ex. saisie janvier-mars
2025, le facteur change le 15 février) — aucune des deux ne couvre alors
l'entrée en entier ? Avant vérification, ce cas retombait dans le même
message générique que "aucun facteur disponible du tout", ce qui n'aide pas
l'utilisateur à comprendre quoi faire.

**Corrigé** : `getFactorForPeriodOrExplain` / `getExchangeRateForPeriodOrExplain`
(`calculation.service.js`) distinguent maintenant explicitement les deux cas :
- **aucune version ne chevauche même partiellement la période** → "Aucune
  version du facteur … n'est disponible pour la période du … au …."
- **une ou plusieurs versions chevauchent partiellement, mais aucune ne
  couvre tout** → message différent, qui cite les tronçons de validité
  disponibles et dit explicitement : *"Scindez votre saisie en plusieurs
  entrées, une par tronçon de période encadré par les dates de changement."*

Utilisé à la fois pour la saisie Module 2 (`activity-entries.service.js`) et
l'estimation Scope 3 (ratio **et** taux de change indépendamment — un message
peut signaler que c'est le ratio qui change de version pendant que le taux
est stable, ou l'inverse). **2 tests dédiés** vérifient le contenu exact du
message (présence de "change de version", "Scindez votre saisie", et des
dates de transition citées), pas seulement le code HTTP.

## Bug trouvé et corrigé (Module 3)

- **Erreur d'encodage bloquant le démarrage des tests** (`22P05,
  report_untranslatable_char`) : le caractère `→` utilisé dans des
  commentaires SQL n'existe pas dans l'encodage WIN1252 que Postgres avait
  sélectionné pour le cluster de test (déterminé par la locale Windows/
  française détectée à l'initialisation). Remplacé par `->` (ASCII) dans les
  fichiers de migration/seed concernés. Détecté immédiatement par
  `npm test` — avant tout passage navigateur.

## Écarts par rapport au brief (Module 3)

- **Champ "contrat d'énergie spécifique" (Scope 2 market-based)** : le brief
  demande explicitement de "prévoir le champ" sans développer la logique
  associée. Non ajouté en V1 — le mécanisme de bascule (décrit ci-dessus)
  fonctionne déjà dès qu'un facteur `electricite_market_based` existe, sans
  nécessiter de champ dédié côté entreprise pour l'instant.
- **Estimation Scope 3 stockée via `activity_entries`/`emission_results`**
  (réutilisation du schéma existant : `site_id = NULL`, `quantity` = montant
  en k€) plutôt qu'une nouvelle table dédiée — évite d'ajouter une table pour
  un concept déjà représentable, garde un seul mécanisme de traçabilité pour
  les trois scopes.

## Module 4 — préparation de données CBAM

**Positionnement juridique respecté à la lettre** (brief, section 8) : le
déclarant CBAM est toujours l'importateur européen, jamais l'exportateur
marocain. Ce module structure des données réutilisables par l'entreprise dans
ses échanges avec son client européen — il ne soumet rien à une autorité ni à
un registre. Vocabulaire verrouillé appliqué aux routes API
(`/api/cbam-prep/...`), aux noms de fonctions (`getCbamPreparationSummary`,
`buildCsvExport`, `buildPdfExport`...), aux libellés UI, au gabarit PDF et à
tous les messages d'erreur — jamais "déclaration", "clé en main", "certifié
IMANOR" ou "soumission au registre".

**`tests/cbam-vocabulary.test.js`** scanne en texte brut (pas un test de rendu
DOM) tous les fichiers utilisateur-visibles du module — service, contrôleur,
routes, gabarit PDF, page React, navigation — et vérifie l'absence de chaque
expression interdite (dont **"déclaration" seul**, pas uniquement la phrase
complète, conformément à la demande explicite). `constants.js` est le seul
fichier exclu du scan : c'est lui qui énumère la liste interdite, il la
contient par nature sans être une chaîne visible par l'utilisateur.

**Réutilisation de l'existant** (pas de duplication) : `product_allocation`
(déjà dans le schéma depuis le début, déjà lu par le `byProduct` du Module 3)
reste la seule source de vérité — aucune nouvelle table "produits". Une
exception ciblée à la règle "pas d'édition" du Module 2 a été ajoutée : `PATCH
/api/activity-entries/:id/product-allocation`, scopée par `company_id` comme
tous les autres endpoints, justifiée parce que cette métadonnée ne touche
jamais `factor_code`/`quantity`/`period`/`scope` et ne remet donc pas en cause
l'immuabilité d'un résultat déjà calculé.

**Distinction matière première / énergie** (demandée explicitement) : dans le
résumé par produit comme dans les exports CSV/PDF, les lignes "matière
première" affichent **"n.c." (non calculé)**, jamais "0" — une valeur "0"
aurait pu être lue à tort comme "émissions nulles vérifiées" par un client
européen. Une note méthodologique explicite l'accompagne partout (UI en
encart visible, pas en footnote ; CSV en première ligne ; PDF en encart) :
*"Une valeur tCO2e absente signifie « non calculé », jamais « émissions
nulles vérifiées »."*

**Bandeau sectoriel** : le lien de navigation et la page restent toujours
accessibles pour les 4 secteurs (jamais bloqués) ; libellé "Préparation CBAM
(optionnel)" et bandeau explicatif automatique pour les 3 secteurs hors
métallurgie, citant les 6 catégories officiellement couvertes par le CBAM.

**Gabarit PDF réutilisable** (`src/modules/reports/pdf-template.js`) :
première utilisation réelle de Puppeteer (dépendance présente depuis le
début, jamais exploitée jusqu'ici). Premier module à générer un PDF, gabarit
volontairement générique pour être repris tel quel par le Module 6.

### Bugs trouvés et corrigés (Module 4)

- **Puppeteer renvoie un `Uint8Array`, pas un `Buffer` Node**, depuis les
  versions récentes. `page.pdf()` était utilisé tel quel dans
  `htmlToPdfBuffer` ; `.toString()` sur le résultat produisait donc une liste
  d'octets séparés par des virgules au lieu du texte binaire attendu — y
  compris dans mon propre smoke-test manuel initial, que j'avais mal lu comme
  "ça marche" alors qu'il affichait déjà les octets bruts. Corrigé avec
  `Buffer.from(pdf)`. Trouvé par le test automatisé qui vérifie les magic
  bytes `%PDF`, pas par la relecture manuelle.
- **Police de marque absente du PDF** : le gabarit ne chargeait aucune police
  de marque. Corrigé une première fois avec un `<link>` Google Fonts (comme
  `index.html`) — mais ça faisait dépendre **chaque génération de PDF** d'un
  appel réseau sortant vers `fonts.googleapis.com`, fragile en production
  (latence, pare-feu, panne du CDN). Corrigé une seconde fois, suite à
  relecture, en **auto-hébergeant les polices** : les 4 fichiers `.woff2`
  réels sont dans `src/modules/reports/fonts/` (IBM Plex Sans et Space
  Grotesk sont des polices variables chez Google Fonts — un seul fichier
  physique couvre plusieurs graisses, d'où 4 fichiers pour 7 règles
  `@font-face`), lus et embarqués en base64 (`data:` URI) directement dans le
  HTML généré. Vérifié : le HTML produit ne contient plus aucune référence à
  `googleapis`/`gstatic` (recherche automatisée dans le texte généré), donc
  aucun appel réseau possible à la génération, en développement comme en
  production. `document.fonts.ready` est attendu explicitement avant
  l'impression PDF pour éviter tout risque de capture prématurée sur police
  de repli.
- Deux corrections de tests (pas de bug applicatif) : assertion `Content-Type`
  trop stricte (Express ajoute légitimement `; charset=utf-8`), et lecture
  d'un corps binaire via `supertest` qui ne restitue pas fidèlement un buffer
  sans configuration avancée — remplacé par une vérification des en-têtes
  côté HTTP et une vérification des octets réels côté service directement.

### Point vérifié suite à relecture — isolation de `GET /cbam-prep/summary` et `/products`

Le test existait déjà mais était trop faible : il vérifiait seulement qu'une
entreprise B **sans aucune donnée propre** recevait une liste vide — ça ne
prouve pas vraiment le scoping (une liste vide peut avoir d'autres causes).
Remplacé par un test où **les deux entreprises ont leurs propres données**
allouées à des produits différents, et où chacune ne voit que les siennes
dans les deux sens (`GET /products` et `GET /summary`).

**66/66 tests passent** à l'issue du Module 4, y compris l'isolation
multi-tenant sur `PATCH product-allocation` et `GET /cbam-prep/summary`, et
le scan de vocabulaire verrouillé. Vérifié en navigateur avec deux
entreprises (métallurgie et automobile) : bandeau conditionnel, assignation
de produit en direct, distinction visuelle matière première/énergie, export
PDF téléchargé et confirmé valide (`%PDF`, 158 Ko) via un fetch authentifié.

## Module 5 — veille financements & taxe carbone nationale

**Même discipline que partout ailleurs dans ce projet : aucun dispositif de
financement ni taux de taxe carbone inventé.** `financing_programs` et
`carbon_tax_parameters` restent des tables vides — prêtes structurellement,
alimentées par insertion SQL directe une fois des données vérifiées
fournies (même geste que pour `emission_factors`/`exchange_rates` : pas
d'interface d'admin en V1, le brief l'autorise explicitement en alternative
à la seed data).

**Mode de travail retenu** : vous transmettez les valeurs (avec leur
source), Claude les insère — jamais l'inverse, même discipline de
vérification que pour les facteurs d'émission. Un fichier de référence
documente à quoi ressemble une insertion correcte pour les deux tables,
y compris la logique de versionnement (ne jamais `UPDATE` un taux en place —
fermer l'ancienne version, en ouvrir une nouvelle, comme `emission_factors`) :
[`server/src/db/templates/financing-and-carbon-tax.sql.example`](server/src/db/templates/financing-and-carbon-tax.sql.example).
Ce fichier n'est pas exécuté automatiquement (dossier hors du seed runner,
extension `.sql.example`) — c'est une documentation, pas un script à lancer.

**Simulateur** : `GET /api/financing/carbon-tax/simulate` calcule à partir
d'un détail par scope (Scope 1, Scope 2 location-based, Scope 3) déjà calculé
au Module 3. Sous le seuil d'assujettissement, le montant estimé est un vrai
**0** (pas "non calculé" comme au Module 4) : c'est une valeur réelle —
l'entreprise n'est simplement pas assujettie — pas une donnée manquante.

### Point vérifié suite à relecture — le périmètre de scopes taxables n'était pas une donnée du brief

Livré initialement avec **"Scope 1 + Scope 2" figé dans le code** (y compris
dans le libellé de l'état vide, qui présupposait déjà cette combinaison avant
toute configuration réelle) — une hypothèse de ma part, jamais spécifiée dans
le brief. Corrigé : `carbon_tax_parameters.taxable_scopes` (`SMALLINT[]`,
`NOT NULL`, sans valeur par défaut — toute ligne insérée doit le déclarer
explicitement) porte maintenant ce périmètre, au même titre que le taux. Le
détail par scope est renvoyé même sans paramètres configurés (état vide),
sans jamais pré-sommer une combinaison supposée. Une fois configuré, l'UI
affiche *"Base de calcul actuelle : Scope X + Y — hypothèse en attente de
confirmation par la Loi de Finances 2026"* au même niveau de visibilité
(même encart) que la mise en garde "estimation indicative". Testé
explicitement : `taxable_scopes = {1}` exclut le Scope 2 même avec des
données Scope 2 présentes ; `taxable_scopes = {1,2,3}` inclut bien le
Scope 3 — la combinaison n'est plus jamais figée dans le code applicatif.

**États vides soignés** (demande explicite avant de commencer ce module) :
composant `EmptyState` réutilisable — pastille "À venir" en vert/menthe
(jamais la couleur d'alerte, ce n'est pas un avertissement), titre, texte
explicatif. Utilisé pour la liste de dispositifs ET pour le simulateur tant
qu'aucun taux n'est configuré. Vérifié en navigateur dans les deux états
(vide, puis avec des données de test insérées manuellement et retirées après
capture — non conservées dans le seed).

**Mise en garde persistante** : "estimation indicative, LF2026 non
stabilisée" reste affichée même une fois un taux réel configuré, pas
seulement pendant l'état vide (conforme au brief : "afficher clairement que
les paramètres sont indicatifs").

**78/78 tests passent**, y compris les tests de configurabilité du périmètre
taxable et l'isolation multi-tenant du simulateur (les émissions d'une
entreprise ne fuient jamais vers une autre).

## Module 6 — rapports & tableau de bord (dernier module de la V1)

**Tableau de bord** (`/tableau-de-bord`, nouveau premier lien de nav) :
réutilise directement `GET /api/calculations/summary` (Module 3), aucune
nouvelle agrégation. Trois graphiques à barres (`recharts`, déjà en
dépendance depuis le lancement du projet, jamais utilisé jusqu'ici) —
répartition par scope, par site, évolution dans le temps. Skill `dataviz`
chargée avant tout code de graphique : un seul ton de marque par mesure
(pas de palette catégorielle multi-teintes à valider), Scope 3 rendu dans un
vert atténué distinct pour signaler visuellement sa moindre confiance —
jamais sommé silencieusement avec le Scope 1/2 dans le total affiché. La vue
tableau des mêmes données existe déjà sur `/calcul` (Module 3), pas
dupliquée ici. État vide explicite (`EmptyState`, réutilisé du Module 5)
quand moins de 2 périodes existent pour le graphique d'évolution.

**Export CSV** : dump complet des données brutes, **toutes natures
confondues** (énergie, matière première, estimations Scope 3) — distinct de
l'export CSV du Module 4 qui est structuré par produit pour un usage CBAM
spécifique et exclut le Scope 3. Même discipline "jamais 0 pour une donnée
non calculée" que le Module 4 (matière première → cellule vide, pas "0").

**Export PDF** : réutilise le gabarit brandé auto-hébergé du Module 4 sans
modification. Annexe méthodologie obligatoire (brief) : GHG Protocol/
ISO 14064-1, et surtout la **liste de tous les facteurs d'émission
réellement utilisés par l'entreprise, chacun avec sa source affichée** —
jamais tout le catalogue `emission_factors`, seulement ce qui a servi à un
calcul, et jamais un facteur sans source.

**Clarification actée avant de coder** : "logo entreprise" dans le brief a
été confirmé comme signifiant le nom de l'entreprise affiché en en-tête
(comme le fait déjà le PDF du Module 4), pas une fonctionnalité d'upload de
logo — qui aurait été un nouveau périmètre (stockage de fichier, upload),
pas une réutilisation de l'existant.

### Bug trouvé et corrigé (Module 6)

**Les barres des graphiques n'apparaissaient pas sur une capture d'écran
plein-page**, alors que l'inspection du DOM confirmait des éléments SVG
`<path>` avec géométrie, couleur et opacité corrects. Cause : le
redimensionnement/scroll interne que Playwright effectue pour assembler une
capture plein-page déclenche le `ResizeObserver` du `ResponsiveContainer`
de recharts, qui relance l'animation d'entrée des barres — capturée à
mi-vol. Confirmé comme un artefact de capture (pas un bug utilisateur réel)
en isolant le graphique dans une capture ciblée, où les barres apparaissaient
correctement. Corrigé quand même, à la source, par choix de conception :
`isAnimationActive={false}` sur les trois graphiques — cohérent avec la
charte ("dense en information utile, pas décorative", section 3), et évite
cette classe de fragilité pour toute vérification future.

**87/87 tests passent (livraison initiale).** Vérifié en navigateur avec des données réparties
sur 2 sites et 2 périodes : les trois graphiques, les cartes de synthèse, et
les deux boutons d'export rendent correctement.

---

### Points vérifiés suite à relecture (Module 6)

Deux vraies lacunes trouvées en relisant avant clôture de la V1, corrigées :

1. **Isolation multi-tenant de l'export PDF jamais réellement testée.** Le
   test existant s'appelait "le CSV et le PDF..." mais son corps n'exerçait
   que le CSV — `getFactorsUsedByCompany` (qui alimente l'annexe méthodologie
   du PDF) n'était scopée-testée nulle part. Corrigé : fonction exportée et
   testée directement (entreprise A avec un facteur utilisé → 1 résultat,
   entreprise B sans données → liste vide), plus un test de génération PDF
   réelle pour l'entreprise B pendant que l'entreprise A a des données.
2. **`base_year` récupéré en base mais jamais utilisé dans le PDF.**
   `getCompany()` sélectionnait déjà la colonne, mais l'annexe méthodologique
   ne mentionnait que le périmètre organisationnel (contrôle opérationnel),
   pas l'année de référence — pourtant exigée par le GHG Protocol Corporate
   Standard aux côtés du périmètre. Corrigé, avec repli explicite "non
   renseignée" si l'entreprise ne l'a jamais définie (jamais `null`/`undefined`
   affiché tel quel). La construction du HTML a été extraite dans une
   fonction dédiée (`buildReportHtml`) pour pouvoir vérifier le contenu
   réellement généré sans avoir à parser un PDF binaire dans les tests.

**91/91 tests passent** après ces deux corrections.

---

## Module 6 (révision) — dashboard professionnel, KPI et système d'alarmes

Révision demandée après la clôture de la V1 : le dashboard basique ci-dessus
est remplacé par une version complète (bandeau de synthèse, répartition
Scope 2 à 4 valeurs, top contributeurs, qualité méthodologique, tendance
MoM/YoY) plus un bandeau "Points d'attention" regroupant des alarmes
auto-référencées. Même discipline que le reste du produit : aucun seuil
sectoriel externe inventé (`sector_benchmarks` créée mais vide, même
principe que `financing_programs`).

**Schéma ajouté** : `companies.annual_revenue_mad` (optionnel, calcul de
l'intensité carbone), `companies.reporting_frequency` (mensuelle/
trimestrielle/annuelle), `sector_benchmarks` (vide), `alert_thresholds`
(seedée directement — seuils opérationnels de bon sens, pas des données
externes à vérifier, contrairement à `emission_factors`).

**Deux clarifications actées avant de coder** (la spec laissait deux points
sous-déterminés, tranchés avec confirmation avant implémentation plutôt
qu'en silence) :
1. "Données manquantes" et "complétude des données" supposaient une
   fréquence de reporting déclarée par l'entreprise, qui n'existait nulle
   part dans le schéma — `reporting_frequency` a été ajouté au profil
   plutôt que de fabriquer une heuristique de délai fixe.
2. "Variation vs année de référence" est calculée sur **l'année civile la
   plus récente disposant de données**, pas sur un cumul depuis toujours
   (qui grossirait mécaniquement avec le temps et rendrait la comparaison
   trompeuse). La même base sert à l'intensité carbone, pour rester
   cohérente avec le CA annuel renseigné.

**Écart volontaire par rapport au libellé littéral de la spec** : "Émissions
totales" (bandeau) est calculée en Scope 1+2 uniquement, jamais fondue avec
le Scope 3 — cohérent avec la discipline déjà posée partout ailleurs dans le
produit (simulateur taxe carbone, dashboard existant), même si la formule
donnée en spec ne filtrait pas explicitement le scope.

**Skill `dataviz` rechargée avant le nouveau code de graphique** — a évité un
vrai défaut : le plan initial prévoyait de distinguer Scope 1 / Scope 2
location-based / Scope 2 market-based par trois teintes de vert différentes.
Le script de validation (`validate_palette.js`) a mesuré une séparation
ΔE de 3.8 entre `#0B6E4F` et `#167A5A`, bien en dessous du plancher de
lisibilité même en vision normale (15) — deux barres auraient été quasi
indiscernables. Corrigé avant d'écrire le composant : l'identité Scope 1/2/3
reste portée par les libellés d'axe (comme déjà le cas), la couleur
n'encode que le statut mesuré/estimé (vert plein vs vert atténué, déjà
établi) et le statut mesuré/défaulté (opacité réduite pour le Scope 2
market-based tant qu'aucun contrat électrique spécifique n'est renseigné).

**Système d'alarmes** (`getAlerts`, `server/src/modules/reports/
dashboard-analytics.service.js`) : 7 alarmes auto-référencées (approche/
dépassement du seuil taxe carbone, variation MoM >20% par site, données
manquantes par site, chute >10 points de la part de facteurs nationaux,
concentration >70% sur un seul poste, garde-fou `base_year_recalculations`
sans raison exploitable — ce dernier cas ne devrait jamais se produire via
l'API, la contrainte `NOT NULL` et la validation Zod l'en empêchent déjà,
mais reste vérifié en base par prudence). Toutes en rouge de la charte
(`#A5342A`), jamais de couleur décorative, groupées dans un seul bandeau.

**23 tests dédiés** couvrent chaque cas limite de calcul (pas seulement le
cas nominal) : les trois raisons d'indisponibilité de "variation vs année de
référence" (`no_data`, `base_year_not_set`, `base_year_no_data`,
`insufficient_history`), la pondération par tCO2e (pas par nombre de lignes)
de la part de facteurs nationaux, le calcul des périodes attendues pour la
complétude (mois manquant au milieu d'une plage), et l'isolation
multi-tenant du nouvel endpoint `GET /api/reports/dashboard-analytics`.

**Vérifié en navigateur** contre l'environnement de démonstration (données
réelles sur 2 sites, plusieurs périodes) : bandeau d'alarmes, 4 tuiles de
synthèse (y compris les états "non disponible" avec message explicite),
répartition par scope à 4 barres, classement des sites, top 5 postes,
qualité méthodologique, tendance avec variations MoM/YoY — tout s'affiche
sans erreur console, migration et seed appliquées sans incident à la base
de démonstration déjà peuplée.

**136/136 tests passent** (113 existants + 23 nouveaux).

---

## Extension — secteurs CBAM ajoutés

Demande explicite : ajouter tous les secteurs officiellement couverts par le
règlement CBAM européen (`CBAM_OFFICIAL_CATEGORIES`, Module 4) comme secteurs
à part entière, en plus des 4 secteurs du brief d'origine — pas à leur place
("AJOUTE", pas "remplace"). `SECTORS` passe de 4 à 10 valeurs :
`automobile`, `textile`, `agroalimentaire`, `metallurgie` (brief d'origine),
`fer_et_acier`, `aluminium`, `ciment`, `engrais`, `electricite`, `hydrogene`
(catégories CBAM).

**Chaque nouveau secteur respecte la même discipline que les 4 d'origine** —
c'était la condition explicite de la demande :
- Une ligne `sector_naf_mapping` avec un vrai code NAF rév.2 (INSEE), pas un
  code inventé. Confiance variable : `fer_et_acier` (24.1), `aluminium`
  (24.42), `ciment` (23.51), `engrais` (20.15) et `electricite` (35.11) ont
  une sous-classe NAF dédiée et stable. **`hydrogene` n'a aucune sous-classe
  NAF propre** — la production d'hydrogène est historiquement classée dans les
  gaz industriels (20.11) ; rattachement signalé comme approximatif dans la
  colonne `notes`, à vérifier au cas par cas, exactement comme le sont déjà
  les rattachements imprécis des 4 secteurs d'origine (ex. "textile" recoupant
  habillement/cuir).
- Un placeholder `scope3_ratio_<secteur>` dans `emission_factors`,
  structurellement inactif (`valid_to = valid_from`, valeur 0), en attente
  d'un vrai ratio ADEME Base Empreinte — aucune valeur inventée pour aucun
  des 6 nouveaux secteurs.
- `CBAM_COVERED_SECTOR` (une seule valeur, `'metallurgie'`) devient
  `CBAM_COVERED_SECTORS` (tableau) : les 6 nouvelles catégories sont par
  définition couvertes par le CBAM (c'est leur seule raison d'exister), plus
  `metallurgie` conservée telle quelle. `automobile`, `textile`,
  `agroalimentaire` restent non couvertes, inchangé. Corrigé aux deux
  endroits où cette logique existait en dur : `cbam-prep.service.js` (backend)
  et `Layout.jsx` (libellé de nav "Préparation CBAM" vs "(optionnel)",
  dupliqué côté frontend car il ne peut pas importer un module serveur).

**Bug latent trouvé en cours de route** : `004_alert_thresholds.sql`
(révision dashboard précédente) était la seule table de seed sans
`ON CONFLICT DO NOTHING`, contrairement à toutes les autres — invisible tant
que `npm run seed` n'était exécuté qu'une fois par base, mais un deuxième
`npm run seed` (nécessaire ici pour propager les nouvelles lignes
`sector_naf_mapping`/`scope3_ratio_*` à la base de démonstration déjà
peuplée) échouait sur une contrainte UNIQUE. Corrigé pour rester cohérent
avec le reste du dossier `seed/`.

**23 tests dédiés** (nouveau fichier `tests/sectors.test.js`) : inscription
acceptée pour les 10 secteurs (et rejetée pour une valeur hors liste),
mapping NAF présent pour chacun, placeholder Scope 3 présent/inactif/à 0 pour
chacun, et `readiness` Scope 3 confirmant `sectorRatioAvailable: false` pour
chacun — preuve que la discipline "structurellement prêt, jamais de valeur
inventée" est bien uniforme sur les 10 secteurs, pas seulement sur les 4
d'origine. Plus 8 tests ajoutés à `cbam-prep.test.js` (6 nouveaux secteurs
confirmés couverts, `textile`/`agroalimentaire` confirmés non couverts,
inchangé après l'ajout).

**164/164 tests passent.** Vérifié en navigateur : liste déroulante des 10
secteurs correcte à l'inscription et au profil, inscription réelle avec le
secteur `fer_et_acier` aboutissant à un libellé de nav "Préparation CBAM"
(sans "optionnel"), confirmant `CBAM_COVERED_SECTORS` appliqué de bout en
bout.

## V1 complète

Les 6 modules du brief sont livrés, testés (164 tests automatisés, isolation
multi-tenant systématique), et vérifiés en navigateur à chaque étape.
Rappels pour la suite :

- **Aucune donnée métier n'a été inventée** : `financing_programs`,
  `carbon_tax_parameters`, les 10 lignes `scope3_ratio_<secteur>` dans
  `emission_factors` (4 secteurs d'origine + 6 catégories CBAM), et
  `sector_benchmarks` (révision dashboard) restent
  vides/inactives jusqu'à transmission de valeurs vérifiées (mode retenu :
  vous transmettez, Claude insère — voir
  [`server/src/db/templates/financing-and-carbon-tax.sql.example`](server/src/db/templates/financing-and-carbon-tax.sql.example)).
- **`taxable_scopes`** (Module 5) et **le taux de change EUR/MAD**
  (`exchange_rates`, Module 3) sont dans la même situation : structurellement
  prêts, aucune valeur fournie.
- Écarts/déviations documentés module par module ci-dessus — à relire avant
  toute mise en production.
- Tests exécutés dans cet environnement via PostgreSQL embarqué
  (`embedded-postgres`, devDependency) ; jamais testé contre un vrai serveur
  PostgreSQL de production.
