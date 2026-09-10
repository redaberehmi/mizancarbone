-- Placeholders structurels pour les ratios monétaires Scope 3 (approche
-- spend-based, GHG Protocol Technical Guidance for Calculating Scope 3
-- Emissions ; source de référence : ADEME Base Empreinte, ratios monétaires
-- kgCO2e/k€ par secteur).
--
-- AUCUNE valeur numérique n'est inventée ici. valid_to = valid_from rend ces
-- lignes structurellement inactives : la logique "facteur courant" utilisée
-- partout dans l'application (WHERE valid_to IS NULL) ne les sélectionnera
-- jamais, donc value_kgco2e = 0 ci-dessous ne peut jamais entrer dans un
-- calcul, même par erreur. Pour activer un secteur : insérer une NOUVELLE
-- ligne avec le même code, la valeur réelle consultée dans la Base
-- Empreinte ADEME, valid_from = aujourd'hui, valid_to = NULL.
INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, valid_to) VALUES
('scope3_ratio_automobile', 'Ratio monétaire Scope 3 — Automobile (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 29). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01'),
('scope3_ratio_textile', 'Ratio monétaire Scope 3 — Textile (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 13). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01'),
('scope3_ratio_agroalimentaire', 'Ratio monétaire Scope 3 — Agroalimentaire (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 10). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01'),
('scope3_ratio_metallurgie', 'Ratio monétaire Scope 3 — Métallurgie (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 24). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01'),
-- Les 6 lignes suivantes correspondent aux catégories officiellement couvertes
-- par le règlement CBAM, ajoutées comme secteurs à part entière (voir SECTORS,
-- auth.validation.js, et CBAM_COVERED_SECTORS, cbam-prep/constants.js).
('scope3_ratio_fer_et_acier', 'Ratio monétaire Scope 3 — Fer et acier (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 24.1). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01'),
('scope3_ratio_aluminium', 'Ratio monétaire Scope 3 — Aluminium (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 24.42). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01'),
('scope3_ratio_ciment', 'Ratio monétaire Scope 3 — Ciment (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 23.51). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01'),
('scope3_ratio_engrais', 'Ratio monétaire Scope 3 — Engrais (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 20.15). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01'),
('scope3_ratio_electricite', 'Ratio monétaire Scope 3 — Électricité (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 35.11). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01'),
('scope3_ratio_hydrogene', 'Ratio monétaire Scope 3 — Hydrogène (NON RENSEIGNÉ)', 3, 'scope3_ratio', 'k€', 0, 'PLACEHOLDER — ratio ADEME Base Empreinte non encore renseigné pour ce secteur (voir sector_naf_mapping, code NAF 20.11, rattachement approximatif). Ligne structurellement inactive (valid_to = valid_from), ne peut pas être utilisée en calcul.', false, 'MA', '2000-01-01', '2000-01-01')
ON CONFLICT (code, valid_from) DO NOTHING;
