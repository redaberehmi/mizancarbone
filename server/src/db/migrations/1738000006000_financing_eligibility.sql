-- Up Migration

-- ============================================================
-- Module 7 (V1.5) — test d'éligibilité automatique par taille d'entreprise.
-- Seuils légaux confirmés : Loi 53-00 "Charte de la PME" —
--   TPE  : effectif < 10 salariés
--   PME  : effectif <= 200 salariés ET (CA HT <= 75 000 000 MAD OU bilan <= 50 000 000 MAD)
--   au-delà : Grande Entreprise (GE)
-- Le "bilan" (total bilan comptable) n'est pas collecté par l'application —
-- seule la branche CA de la condition PME est testable. Jamais présenté
-- comme la classification officielle Maroc PME pour un dispositif donné :
-- Maroc PME/AMEE peuvent appliquer des seuils propres à Tatwir, non
-- confirmés à ce jour malgré cette base légale solide (voir
-- SIZE_CATEGORY_CAVEAT, financing.service.js).
-- ============================================================

-- Repli déclaratif quand le CA n'est pas renseigné (le calcul automatique
-- est alors impossible faute de donnée, jamais une estimation).
ALTER TABLE companies ADD COLUMN declared_size_category VARCHAR(8)
    CHECK (declared_size_category IS NULL OR declared_size_category IN ('tpe', 'pme', 'ge'));

-- Catégories de taille éligibles à un programme — jamais de valeur par
-- défaut implicite (même discipline que carbon_tax_parameters.taxable_scopes) :
-- toute ligne doit déclarer explicitement qui elle vise.
ALTER TABLE financing_programs ADD COLUMN eligible_size_categories VARCHAR(8)[];
UPDATE financing_programs SET eligible_size_categories = '{tpe,pme}' WHERE name = 'Tatwir Croissance Verte';
ALTER TABLE financing_programs ALTER COLUMN eligible_size_categories SET NOT NULL;

-- Down Migration

ALTER TABLE financing_programs DROP COLUMN IF EXISTS eligible_size_categories;
ALTER TABLE companies DROP COLUMN IF EXISTS declared_size_category;
