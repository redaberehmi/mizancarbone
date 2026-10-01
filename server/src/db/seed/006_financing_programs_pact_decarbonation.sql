-- PACT'Décarbonation/Eau — deuxième dispositif de financement réel du
-- Module 7 (V1.5). Dispositif du programme "PACTE TPME" porté par Maroc PME,
-- appui technique et financier à la décarbonation et à la gestion de l'eau
-- des TPME industrielles marocaines.
--
-- Contenu confirmé par l'utilisateur (taux, plafond, prestations nommées
-- ci-dessous) ; source primaire recherchée par Claude Code sur demande —
-- voir financing_program_rules pour le détail et les réserves.
--
-- eligible_size_categories volontairement NULL : aucun seuil de taille
-- propre à CE programme n'est confirmé à ce jour (une mention de "CA <= 200
-- MDH" trouvée en recherche semble se mélanger avec les critères de Tatwir
-- dans le résumé consulté — non fiable, non codé, voir rule_key
-- 'size_eligibility_lead').
-- alerts_eligible = false, explicite (pas juste la valeur par défaut) :
-- décision délibérée suite au cadrage V1.5 — une contradiction a été trouvée
-- sur un fait STRUCTURANT (plafond 1 MDH vs 2 MDH selon les sources) et un
-- possible changement de cadre entier (absorption dans le nouveau "Pacte
-- TPME", avril 2026) rendent ce dispositif pas assez fiable pour générer une
-- alerte "Nouveau" tant que ces points ne sont pas éclaircis.
-- size_undetermined_reason : remplace le message générique "Non déterminé"
-- par une explication explicite — ce n'est pas une simple donnée manquante
-- de routine, c'est un doute réel sur la fiabilité du dispositif lui-même.
INSERT INTO financing_programs (name, description, eligibility, source_url, active, eligible_size_categories, alerts_eligible, size_undetermined_reason)
VALUES (
    'PACT''Décarbonation/Eau',
    'Dispositif du programme PACTE TPME porté par Maroc PME, offrant un appui technique et financier aux TPME industrielles marocaines pour leur décarbonation et la gestion de leurs ressources en eau.',
    'TPME industrielles marocaines. Seuil de taille propre à ce programme non confirmé à ce jour (voir registre des règles).',
    'https://greenfinance.ma/pactdecarbonation-eau-page/',
    true,
    NULL,
    false,
    'Éligibilité non déterminée pour une raison plus sérieuse qu''une simple donnée manquante : une contradiction a été trouvée sur le plafond lui-même (1 MDH vs 2 MDH selon les sources), et ce dispositif pourrait être absorbé dans le nouveau "Pacte TPME" (annoncé avril 2026). Statut à suivre avant toute candidature.'
)
ON CONFLICT (name) DO NOTHING;

UPDATE financing_programs SET
    alerts_eligible = false,
    size_undetermined_reason = 'Éligibilité non déterminée pour une raison plus sérieuse qu''une simple donnée manquante : une contradiction a été trouvée sur le plafond lui-même (1 MDH vs 2 MDH selon les sources), et ce dispositif pourrait être absorbé dans le nouveau "Pacte TPME" (annoncé avril 2026). Statut à suivre avant toute candidature.'
WHERE name = 'PACT''Décarbonation/Eau';

INSERT INTO financing_program_components (financing_program_id, label, beneficiary_type, subsidy_rate_pct, cap_amount_mad, notes, source, active) VALUES
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'Conseil et expertise technique',
        NULL,
        80.00,
        1000000.00,
        'Prestations confirmées : plan de décarbonation, diagnostics énergétiques et environnementaux, stratégie verte, conformité normes/labels (RSE, management environnemental/énergie), démarche développement durable, gestion de la productivité en temps réel. "Bilan carbone" comme prestation nommée à part entière : NON CONFIRMÉ comme catégorie officielle du programme (voir registre des règles) — ne pas présenter comme une prestation distincte confirmée.',
        'Confirmé par l''utilisateur ; taux et plafond corroborés par recherche (voir financing_program_rules)',
        true
    )
ON CONFLICT (financing_program_id, label, (COALESCE(beneficiary_type, ''))) DO NOTHING;

-- ============================================================
-- Registre des règles — deux faits vérifiés par l'utilisateur, un fait
-- recherché par Claude Code (rate_and_cap, corroboration), et deux réserves
-- explicitement NON confirmées (bilan carbone, piste de seuil de taille).
-- ============================================================
INSERT INTO financing_program_rules (financing_program_id, rule_key, rule_label, rule_detail, primary_source, verified_at, verified_by, status, rule_type) VALUES
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'rate_and_cap',
        'Taux de prise en charge et plafond',
        '80% du coût des actions de conseil et d''expertise technique, plafonné à 1 000 000 MAD par bénéficiaire.',
        'Confirmé par l''utilisateur ; corroboré par https://greenfinance.ma/pactdecarbonation-eau-page/ (page dédiée). marocpme.gov.ma non vérifiable directement : certificat SSL invalide, même blocage que le portail de candidature Tatwir.',
        CURRENT_DATE,
        'claude_code',
        'confirme',
        'autre'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'named_services',
        'Prestations éligibles nommées',
        'Plan de décarbonation, diagnostics énergétiques et environnementaux, stratégie verte, conformité normes/labels (RSE, management environnemental/énergie), démarche développement durable, gestion de la productivité en temps réel.',
        'Transmis et vérifié par l''utilisateur.',
        CURRENT_DATE,
        'utilisateur',
        'confirme',
        'autre'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'bilan_carbone_named_service',
        '"Bilan carbone" comme prestation nommée à part',
        'Une source secondaire non officielle (greenfinance.ma) nomme explicitement "Bilan Carbone & Plan décarbonation" comme catégorie de projet éligible à part entière. Non vérifié sur un document officiel marocpme.gov.ma (certificat SSL invalide, page non consultable automatiquement). Ne pas coder comme catégorie confirmée du programme tant qu''un document officiel ne le nomme pas explicitement.',
        'https://greenfinance.ma/pactdecarbonation-eau-page/ — source secondaire, non officielle, à recouper',
        CURRENT_DATE,
        'claude_code',
        'a_confirmer',
        'autre'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'size_eligibility_lead',
        'Piste de seuil de taille (non confirmée)',
        'Une recherche a fait apparaître une mention de chiffre d''affaires annuel <= 200 MDH sur les 3 derniers exercices comme critère d''éligibilité, mais cette mention semblait se mélanger avec les critères du programme Tatwir dans le résumé consulté — non fiable en l''état. Aucune valeur codée dans eligible_size_categories tant que non recoupé sur une source primaire propre à ce programme.',
        'Résumé de recherche web non vérifié, à recouper sur une source primaire',
        CURRENT_DATE,
        'claude_code',
        'non_confirme',
        'critere_eligibilite'
    )
ON CONFLICT (financing_program_id, rule_key) DO UPDATE SET
    rule_detail = EXCLUDED.rule_detail,
    primary_source = EXCLUDED.primary_source,
    verified_at = EXCLUDED.verified_at,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    rule_type = EXCLUDED.rule_type;
