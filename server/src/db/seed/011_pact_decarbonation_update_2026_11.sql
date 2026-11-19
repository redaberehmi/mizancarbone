-- ============================================================
-- PACT'Décarbonation/Eau — mise à jour du 2026-11-18.
-- Source : page officielle https://marocpme.gov.ma/pactdecarbonation-eau/
-- La page n'a pas pu être ouverte directement (certificat TLS refusé) ; son
-- contenu a été lu via l'extrait indexé par un moteur de recherche le
-- 2026-11-18. À relire directement sur le site avant toute candidature.
-- Exécuté après 006 (ordre alphabétique) : ces mises à jour priment.
-- Les conditions de PACT ne sont jamais mélangées avec celles de Tatwir.
-- ============================================================

UPDATE financing_programs SET
    source_url = 'https://marocpme.gov.ma/pactdecarbonation-eau/',
    eligibility = 'Entreprise : de droit privé marocain, CA annuel HT <= 200 MDH sur un exercice clos durant les trois dernières années, non filiale (contrôle > 50 % du capital ou des droits de vote) d''une société dépassant ce seuil ; consortiums et groupements sous conditions. Prestation : réalisée et facturée par un prestataire référencé par Maroc PME. Les deux conditions sont distinctes et ne sont pas vérifiées automatiquement par MizanCarbone.',
    size_undetermined_reason = 'Critère officiel lu sur la page Maroc PME (2026-11-18) : CA HT <= 200 MDH et absence de rattachement (> 50 %) à une société dépassant ce seuil. MizanCarbone ne collecte pas la structure capitalistique : la condition « non filiale » est à vérifier par l''entreprise. Le rattachement éventuel au « Pacte TPME » reste à confirmer.'
WHERE name = 'PACT''Décarbonation/Eau';

INSERT INTO financing_program_rules (financing_program_id, rule_key, rule_label, rule_detail, primary_source, verified_at, verified_by, status, rule_type) VALUES
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'rate_and_cap',
        'Taux de prise en charge et plafond',
        '80 % du coût, plafonné à 1 MDH par bénéficiaire, appliqué à la facture du prestataire référencé. L''entreprise règle les 20 % restants et la TVA.',
        'https://marocpme.gov.ma/pactdecarbonation-eau/ (contenu lu via extrait de moteur de recherche le 2026-11-18 ; accès direct refusé : certificat TLS)',
        '2026-11-18', 'claude_code', 'confirme', 'autre'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'bilan_carbone_named_service',
        'Bilan carbone et plan de décarbonation',
        'La page officielle cite « le bilan carbone et le plan de décarbonation » et « le déploiement de solutions de décarbonation des sites industriels » parmi les actions couvertes, ainsi que les diagnostics eau, énergie et environnement et les projets de mise en conformité.',
        'https://marocpme.gov.ma/pactdecarbonation-eau/ (contenu lu via extrait de moteur de recherche le 2026-11-18)',
        '2026-11-18', 'claude_code', 'confirme', 'autre'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'size_eligibility_lead',
        'Éligibilité de l''entreprise (taille et rattachement)',
        'Entreprise de droit privé marocain ayant réalisé un CA annuel HT <= 200 MDH sur un exercice clos durant les trois dernières années ; ne doit pas être filiale, directe ou indirecte, d''une société dépassant ce seuil (contrôle > 50 % du capital ou des droits de vote). Consortiums et groupements acceptés sous conditions de CA moyen.',
        'https://marocpme.gov.ma/pactdecarbonation-eau/ (contenu lu via extrait de moteur de recherche le 2026-11-18)',
        '2026-11-18', 'claude_code', 'confirme', 'critere_eligibilite'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'provider_condition',
        'Éligibilité du prestataire',
        'Le taux s''applique à la facture d''un prestataire référencé par Maroc PME. Les conditions de référencement des prestataires n''ont pas été consultées (règlement du programme non lu).',
        'https://marocpme.gov.ma/pactdecarbonation-eau/ (extrait du 2026-11-18) ; règlement du programme à consulter',
        '2026-11-18', 'claude_code', 'a_confirmer', 'critere_eligibilite'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'software_subscription',
        'Abonnement à un logiciel',
        'Rien dans les informations consultées n''indique qu''un abonnement à un logiciel (y compris MizanCarbone) soit une dépense prise en charge : le dispositif vise des prestations de conseil et d''expertise facturées par un prestataire référencé. À ne pas présenter comme subventionnable.',
        'Analyse de la page officielle (2026-11-18)',
        '2026-11-18', 'claude_code', 'non_confirme', 'autre'
    ),
    (
        (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau'),
        'framework_pacte_tpme',
        'Rattachement au « Pacte TPME »',
        'Le rattachement éventuel de ce dispositif au « Pacte TPME » (annoncé en avril 2026) n''a pas été confirmé par la page consultée.',
        'Non confirmé',
        '2026-11-18', 'claude_code', 'a_confirmer', 'autre'
    )
ON CONFLICT (financing_program_id, rule_key) DO UPDATE SET
    rule_label = EXCLUDED.rule_label,
    rule_detail = EXCLUDED.rule_detail,
    primary_source = EXCLUDED.primary_source,
    verified_at = EXCLUDED.verified_at,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    rule_type = EXCLUDED.rule_type;

UPDATE financing_program_components SET
    notes = 'Actions couvertes selon la page officielle : bilan carbone et plan de décarbonation ; déploiement de solutions de décarbonation des sites industriels ; diagnostics eau, énergie et environnement ; projets de mise en conformité. Prise en charge sur facture d''un prestataire référencé.',
    source = 'https://marocpme.gov.ma/pactdecarbonation-eau/ (extrait du 2026-11-18)'
WHERE financing_program_id = (SELECT id FROM financing_programs WHERE name = 'PACT''Décarbonation/Eau')
  AND label = 'Conseil et expertise technique';
