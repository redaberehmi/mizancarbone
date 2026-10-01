-- Tatwir Croissance Verte — premier dispositif de financement réel du
-- Module 7 (V1.5). Porté par Maroc PME et l'AMEE (Agence Marocaine pour
-- l'Efficacité Énergétique), sous tutelle du ministère de l'Industrie et du
-- Commerce. Subvention non remboursable, sans garantie exigée, formalisée
-- par un "contrat de croissance".
--
-- Sources :
--   - https://www.mcinet.gov.ma/fr/actualites/plan-de-relance-industrielle-lancement-du-programme-tatwir-croissance-verte-pour-lappui
--     (ministère de l'Industrie — confirme les volets investissement 30% et
--     conseil/expertise technique 80% PME / 90% TPE comme deux mécanismes
--     séparés, pas un taux par catégorie de projet)
--   - Portail de candidature officiel : candidature.marocpme.gov.ma/tatwir-vert/
--     (certificat SSL invalide au moment de la vérification — contenu non
--     consultable automatiquement, cité comme référence du dispositif)
--   - marocpme.gov.ma (officiel), Bank of Africa, guide CGEM-TTA/Tamwilcom
--     (mars 2022) — 3 sources convergentes sur le seuil TPE/PME propre au
--     programme (voir financing_program_rules, rule_key='size_threshold')
--
-- Volet "Innovation et développement produit" : mentionné dans l'offre
-- intégrée du programme mais son taux exact n'est confirmé sur aucune des
-- sources disponibles — inséré avec subsidy_rate_pct NULL et active=false
-- (jamais affiché tant que non confirmé), même discipline que les
-- placeholders scope3_ratio_<secteur>.
--
-- IMPORTANT — seuil TPE/PME propre au programme, PAS la Charte de la PME :
-- confirmé indépendamment (3 sources) que Tatwir utilise son propre critère
-- (CA annuel HT uniquement), distinct de la Loi 53-00 (effectif + CA/bilan)
-- utilisée par défaut ailleurs dans l'application. tpe_max_ca_mad/
-- pme_max_ca_mad ci-dessous encodent CE critère programme — la fonction
-- d'éligibilité (financing.service.js) l'utilise en priorité sur la Loi
-- 53-00 générique quand il est renseigné.
-- alerts_eligible = true : décision délibérée (pas dérivée du registre),
-- confirmée après cadrage explicite malgré l'hypothèse non confirmée
-- (bfr_aid_hypothesis) déjà présente — cette hypothèse porte sur un
-- sous-mécanisme secondaire, pas sur un fait structurant du programme.
INSERT INTO financing_programs (
    name, description, eligibility, source_url, active, eligible_size_categories,
    tpe_max_ca_mad, pme_max_ca_mad, size_rule_source, non_automated_conditions,
    alerts_eligible, deadline_note
)
VALUES (
    'Tatwir Croissance Verte',
    'Offre intégrée de soutien à la décarbonation des TPME industrielles, portée par Maroc PME et l''AMEE (ministère de l''Industrie et du Commerce). Combine appui à l''investissement, soutien à l''innovation et conseil/expertise technique. Subvention non remboursable, sans garantie exigée, formalisée par un contrat de croissance.',
    'TPME industrielles marocaines portant un projet relevant d''une des catégories éligibles (voir financing_program_categories).',
    'https://www.mcinet.gov.ma/fr/actualites/plan-de-relance-industrielle-lancement-du-programme-tatwir-croissance-verte-pour-lappui',
    true,
    '{tpe,pme}',
    10000000.00,
    200000000.00,
    'Critère propre au programme (pas la Charte de la PME/Loi 53-00) : TPE = CA annuel HT <= 10 MDH, PME = CA annuel HT entre 10 et 200 MDH. Confirmé via 3 sources convergentes : marocpme.gov.ma (officiel), Bank of Africa, guide CGEM-TTA/Tamwilcom (mars 2022).',
    'Condition de transparence : inscription au registre de commerce, régularité fiscale et régularité CNSS. Source : guide CGEM-TTA/Tamwilcom, mars 2022 — à re-vérifier sur une source plus récente si possible. Non testée automatiquement (aucune donnée collectée par l''application) : à vérifier vous-même avant candidature.',
    true,
    'Fonctionne par éditions successives (ex. édition 2022) — aucune date limite récurrente confirmée à ce jour. Pas de mécanisme de rappel tant qu''une vraie échéance n''est pas identifiée.'
)
ON CONFLICT (name) DO NOTHING;

-- Corrige les lignes déjà seedées avant l'ajout de ces champs (une simple
-- INSERT ... ON CONFLICT DO NOTHING ne les aurait jamais mis à jour).
UPDATE financing_programs SET
    eligibility = 'TPME industrielles marocaines portant un projet relevant d''une des catégories éligibles (voir financing_program_categories).',
    tpe_max_ca_mad = 10000000.00,
    pme_max_ca_mad = 200000000.00,
    size_rule_source = 'Critère propre au programme (pas la Charte de la PME/Loi 53-00) : TPE = CA annuel HT <= 10 MDH, PME = CA annuel HT entre 10 et 200 MDH. Confirmé via 3 sources convergentes : marocpme.gov.ma (officiel), Bank of Africa, guide CGEM-TTA/Tamwilcom (mars 2022).',
    non_automated_conditions = 'Condition de transparence : inscription au registre de commerce, régularité fiscale et régularité CNSS. Source : guide CGEM-TTA/Tamwilcom, mars 2022 — à re-vérifier sur une source plus récente si possible. Non testée automatiquement (aucune donnée collectée par l''application) : à vérifier vous-même avant candidature.',
    alerts_eligible = true,
    deadline_note = 'Fonctionne par éditions successives (ex. édition 2022) — aucune date limite récurrente confirmée à ce jour. Pas de mécanisme de rappel tant qu''une vraie échéance n''est pas identifiée.'
WHERE name = 'Tatwir Croissance Verte';

INSERT INTO financing_program_components (financing_program_id, label, beneficiary_type, subsidy_rate_pct, cap_amount_mad, notes, source, active) VALUES
    (
        (SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'),
        'Investissement',
        NULL,
        30.00,
        NULL,
        'Prime d''investissement pour le financement des équipements industriels. PISTE NON CONFIRMÉE (mise à jour) : pourrait s''agir d''une aide remboursable pour le besoin en fonds de roulement (BFR), autour de 5% PME / 10% TPE — deux sources se contredisent légèrement sur les pourcentages exacts par catégorie, à clarifier avant d''en faire un champ à part. Plafond non communiqué publiquement.',
        'mcinet.gov.ma — Plan de Relance Industrielle, lancement Tatwir Croissance Verte',
        true
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'),
        'Conseil et expertise technique',
        'PME',
        80.00,
        NULL,
        'Audits énergétiques/environnementaux, mise en conformité normes/labels, suivi IoT de la performance énergétique, analyse de cycle de vie produit. Plafond non communiqué publiquement.',
        'mcinet.gov.ma — Plan de Relance Industrielle, lancement Tatwir Croissance Verte',
        true
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'),
        'Conseil et expertise technique',
        'TPE',
        90.00,
        NULL,
        'Audits énergétiques/environnementaux, mise en conformité normes/labels, suivi IoT de la performance énergétique, analyse de cycle de vie produit. Plafond non communiqué publiquement.',
        'mcinet.gov.ma — Plan de Relance Industrielle, lancement Tatwir Croissance Verte',
        true
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'),
        'Innovation et développement produit',
        NULL,
        NULL,
        NULL,
        'PLACEHOLDER — volet mentionné dans l''offre intégrée du programme ("soutien à l''innovation") mais taux exact non confirmé sur les sources disponibles. Ligne structurellement présente, active=false : ne jamais afficher tant que le taux réel n''est pas obtenu directement auprès de Maroc PME/AMEE.',
        'PLACEHOLDER — taux non confirmé',
        false
    )
-- L'index unique normalise NULL en '' (voir migration 1738000007000) : le
-- conflict target doit reprendre exactement la même expression, sinon
-- Postgres ne reconnaît pas la correspondance et l'insertion échoue.
ON CONFLICT (financing_program_id, label, (COALESCE(beneficiary_type, ''))) DO NOTHING;

-- Corrige la note du volet Investissement déjà seedé avant la nouvelle piste
-- (aide BFR) trouvée par l'utilisateur — sinon l'ancienne formulation
-- ("apport fonds propres exigé") resterait affichée indéfiniment.
UPDATE financing_program_components SET
    notes = 'Prime d''investissement pour le financement des équipements industriels. PISTE NON CONFIRMÉE (mise à jour) : pourrait s''agir d''une aide remboursable pour le besoin en fonds de roulement (BFR), autour de 5% PME / 10% TPE — deux sources se contredisent légèrement sur les pourcentages exacts par catégorie, à clarifier avant d''en faire un champ à part. Plafond non communiqué publiquement.'
WHERE financing_program_id = (SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte')
  AND label = 'Investissement';

INSERT INTO financing_program_categories (financing_program_id, label) VALUES
    ((SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'), 'Transition énergétique'),
    ((SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'), 'Filières vertes'),
    ((SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'), 'Innovation éco-conçue'),
    ((SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'), 'Technologies propres')
ON CONFLICT (financing_program_id, label) DO NOTHING;

-- ============================================================
-- Registre officiel des règles de financement — traçabilité par fait
-- vérifié. verified_by='utilisateur' : ces trois faits ont été vérifiés
-- indépendamment par l'utilisateur (pas une recherche faite par Claude Code).
-- ============================================================
INSERT INTO financing_program_rules (financing_program_id, rule_key, rule_label, rule_detail, primary_source, verified_at, verified_by, status, rule_type) VALUES
    (
        (SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'),
        'size_threshold',
        'Seuil TPE/PME (critère programme, pas Loi 53-00)',
        'TPE : CA annuel HT <= 10 MDH. PME : CA annuel HT entre 10 et 200 MDH. Au-delà : grande entreprise. Critère propre au programme Tatwir, distinct de la Charte de la PME (Loi 53-00) qui reste la référence par défaut pour les autres programmes.',
        'marocpme.gov.ma (officiel), Bank of Africa, guide CGEM-TTA/Tamwilcom (mars 2022) — 3 sources convergentes',
        CURRENT_DATE,
        'utilisateur',
        'confirme',
        'critere_eligibilite'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'),
        'transparency_condition',
        'Condition de transparence',
        'Inscription au registre de commerce, régularité fiscale et régularité CNSS. Non testée automatiquement (aucune donnée collectée par l''application).',
        'Guide CGEM-TTA/Tamwilcom, mars 2022',
        CURRENT_DATE,
        'utilisateur',
        'confirme',
        'exclusion'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'Tatwir Croissance Verte'),
        'bfr_aid_hypothesis',
        'Apport fonds propres — hypothèse aide BFR',
        'Pourrait être une aide remboursable pour le besoin en fonds de roulement (BFR), ~5% PME / ~10% TPE — deux sources se contredisent légèrement sur les pourcentages exacts par catégorie. Remplace l''ancienne hypothèse "apport fonds propres exigé de l''entreprise".',
        'Deux sources non précisées explicitement au-delà de leur existence — à clarifier',
        CURRENT_DATE,
        'utilisateur',
        'non_confirme',
        'autre'
    )
ON CONFLICT (financing_program_id, rule_key) DO UPDATE SET
    rule_detail = EXCLUDED.rule_detail,
    primary_source = EXCLUDED.primary_source,
    verified_at = EXCLUDED.verified_at,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    rule_type = EXCLUDED.rule_type;
