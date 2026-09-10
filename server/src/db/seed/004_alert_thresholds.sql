-- Seuils opérationnels des alarmes auto-référencées du dashboard (spec
-- "Dashboard émissions professionnel", section 3). Ce sont des paramètres de
-- bon sens ajustables sans redéploiement, pas des données externes à
-- vérifier — contrairement à emission_factors ou financing_programs, ils
-- peuvent être seedés directement.
INSERT INTO alert_thresholds (code, label, threshold_value, unit, active) VALUES
    ('taxe_approche_seuil_pct', 'Approche du seuil d''assujettissement à la taxe carbone', 90, '%', true),
    ('variation_mom_max_pct', 'Variation anormale d''une période à l''autre sur un même site', 20, '%', true),
    ('donnees_manquantes_periodes_max', 'Périodes attendues sans saisie avant alerte, par site', 1, 'périodes', true),
    ('is_national_baisse_points_max', 'Recul de la part de facteurs nationaux vs période précédente', 10, 'points', true),
    ('concentration_poste_max_pct', 'Concentration excessive sur un seul poste d''émission', 70, '%', true)
ON CONFLICT (code) DO NOTHING;
