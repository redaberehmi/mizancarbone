-- Facteurs d'émission génériques internationaux (GHG Protocol/IEA), jeu de
-- données initial. Tous is_national = false : à remplacer dès que les
-- facteurs de l'Outil Bilan Carbone Maroc (FM6E/CGEM/IMANOR) seront intégrés.
INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from) VALUES
('electricity_ma_location_based_kwh', 'Électricité réseau national (mix Maroc, location-based)', 2, 'electricite_location_based', 'kWh', 0.644, 'Mix électrique Maroc 2024 — générique, À REMPLACER par facteur Outil Bilan Carbone Maroc dès disponible', false, 'MA', '2024-01-01'),
('diesel_L', 'Gasoil / Diesel routier', 1, 'combustion_mobile', 'L', 2.68, 'Facteur standard GHG Protocol/IEA — À REMPLACER par facteur Outil Bilan Carbone Maroc dès disponible', false, 'MA', '2024-01-01'),
('gasoline_L', 'Essence', 1, 'combustion_mobile', 'L', 2.31, 'Facteur standard GHG Protocol/IEA — À REMPLACER par facteur Outil Bilan Carbone Maroc dès disponible', false, 'MA', '2024-01-01'),
('natural_gas_m3', 'Gaz naturel', 1, 'combustion_fixe', 'm3', 2.02, 'Facteur standard GHG Protocol/IEA — À REMPLACER par facteur Outil Bilan Carbone Maroc dès disponible', false, 'MA', '2024-01-01'),
('lpg_kg', 'GPL / Butane-Propane', 1, 'combustion_fixe', 'kg', 2.98, 'Facteur standard GHG Protocol/IEA — À REMPLACER par facteur Outil Bilan Carbone Maroc dès disponible', false, 'MA', '2024-01-01'),
('fuel_oil_L', 'Fioul lourd', 1, 'combustion_fixe', 'L', 3.15, 'Facteur standard GHG Protocol/IEA — À REMPLACER par facteur Outil Bilan Carbone Maroc dès disponible', false, 'MA', '2024-01-01')
ON CONFLICT (code, valid_from) DO NOTHING;
