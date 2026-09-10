-- Correspondance secteur cible -> code NAF rév.2 (INSEE), utilisée pour situer
-- chaque secteur dans la nomenclature que la Base Empreinte ADEME suit pour
-- ses ratios monétaires. Les codes ci-dessous sont les divisions NAF de
-- premier niveau, stables et publiques — à affiner vers la sous-catégorie
-- exacte de la Base Empreinte une fois consultée (voir colonne "notes").
-- Les 6 lignes suivantes correspondent aux catégories officiellement
-- couvertes par le règlement CBAM européen (CBAM_OFFICIAL_CATEGORIES),
-- ajoutées comme secteurs à part entière. Confiance variable selon le
-- secteur : fer_et_acier/aluminium/ciment/engrais/electricite ont une
-- sous-classe NAF dédiée et stable ; hydrogene n'a PAS de sous-classe NAF
-- propre (sa production est historiquement classée dans les gaz industriels)
-- — signalé explicitement en note, à vérifier au cas par cas comme les autres.
INSERT INTO sector_naf_mapping (sector, naf_code_reference, naf_label, notes) VALUES
('automobile', '29', 'Industrie automobile', 'Construction de véhicules automobiles, remorques et semi-remorques. Affiner vers la sous-catégorie Base Empreinte correspondant à l''activité précise (équipementier vs assembleur, etc.).'),
('textile', '13', 'Fabrication de textiles', 'Le secteur "textile" du brief peut recouper les divisions NAF 14 (habillement) et 15 (cuir/chaussure) selon l''activité réelle de l''entreprise — à vérifier au cas par cas et affiner vers la sous-catégorie Base Empreinte correspondante.'),
('agroalimentaire', '10', 'Industries alimentaires', 'La division NAF 11 (fabrication de boissons) peut être pertinente selon l''activité réelle. Affiner vers la sous-catégorie Base Empreinte correspondante.'),
('metallurgie', '24', 'Métallurgie', 'Affiner vers la sous-catégorie Base Empreinte correspondant au type de métal / procédé (sidérurgie, métaux non ferreux, fonderie...).'),
('fer_et_acier', '24.1', 'Sidérurgie', 'Sous-classe NAF de la division 24 (Métallurgie), spécifique à la production de fer, fonte et acier — catégorie officiellement couverte par le CBAM. Affiner vers la sous-catégorie Base Empreinte correspondant au procédé exact (haut fourneau, four électrique...).'),
('aluminium', '24.42', 'Métallurgie de l''aluminium', 'Sous-classe NAF de la division 24 — catégorie officiellement couverte par le CBAM. Affiner vers la sous-catégorie Base Empreinte correspondante (production primaire vs recyclage/seconde fusion, qui ont des profils d''émission très différents).'),
('ciment', '23.51', 'Fabrication de ciment', 'Sous-classe NAF de la division 23 (Fabrication d''autres produits minéraux non métalliques) — catégorie officiellement couverte par le CBAM. Affiner vers la sous-catégorie Base Empreinte correspondante.'),
('engrais', '20.15', 'Fabrication de produits azotés et d''engrais', 'Sous-classe NAF de la division 20 (Industrie chimique) — catégorie officiellement couverte par le CBAM. Affiner vers la sous-catégorie Base Empreinte correspondante.'),
('electricite', '35.11', 'Production d''électricité', 'Sous-classe NAF de la division 35 (Production et distribution d''électricité, de gaz, de vapeur et d''air conditionné) — catégorie officiellement couverte par le CBAM. Affiner selon le mix de production réel de l''entreprise (thermique, renouvelable...).'),
('hydrogene', '20.11', 'Fabrication de gaz industriels (approximatif)', 'AUCUNE sous-classe NAF dédiée à la production d''hydrogène n''existe à ce jour — 20.11 (gaz industriels) est le rattachement le plus proche, à vérifier explicitement au cas par cas avant tout usage. Catégorie officiellement couverte par le CBAM.')
ON CONFLICT (sector) DO NOTHING;
