import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';
import { computeCompanySizeCategory } from '../src/modules/financing/financing.service.js';

const company = {
  companyName: 'Metal Forge SA',
  sector: 'metallurgie',
  email: 'contact@metalforge.ma',
  password: 'mot-de-passe-solide-123',
};

let agent;
let siteId;

beforeEach(async () => {
  await resetDatabase();
  agent = request.agent(app);
  await agent.post('/api/auth/register').send(company);
  const siteRes = await agent.post('/api/companies/me/sites').send({ name: 'Site Tanger', city: 'Tanger' });
  siteId = siteRes.body.site.id;
});

afterAll(async () => {
  await closeDatabase();
});

describe('GET /api/financing/programs', () => {
  // Depuis le seed 005 (Module 7, V1.5), "Tatwir Croissance Verte" est un
  // dispositif réel et vérifié (source mcinet.gov.ma) — la liste n'est donc
  // plus vide par défaut, mais elle ne doit contenir QUE ce dispositif tant
  // qu'aucun autre n'a été transmis avec sa source : jamais un dispositif
  // fabriqué en plus de celui-ci.
  it("ne renvoie que les dispositifs réels et vérifiés (Tatwir Croissance Verte, PACT'Décarbonation/Eau), rien de fabriqué en plus", async () => {
    const res = await agent.get('/api/financing/programs');
    expect(res.status).toBe(200);
    expect(res.body.programs.map((p) => p.name).sort()).toEqual(["PACT'Décarbonation/Eau", 'Tatwir Croissance Verte'].sort());
  });

  it('renvoie les dispositifs actifs, exclut les inactifs', async () => {
    await pool.query(
      `INSERT INTO financing_programs (name, description, eligibility, source_url, active, eligible_size_categories)
       VALUES ('Test Dispositif Actif', 'Description test', 'PME industrielles', 'https://example.ma', true, '{tpe,pme}')`,
    );
    await pool.query(
      `INSERT INTO financing_programs (name, active, eligible_size_categories) VALUES ('Test Dispositif Inactif', false, '{tpe,pme}')`,
    );

    const res = await agent.get('/api/financing/programs');
    expect(res.status).toBe(200);
    expect(res.body.programs.map((p) => p.name)).toContain('Test Dispositif Actif');
    expect(res.body.programs.map((p) => p.name)).not.toContain('Test Dispositif Inactif');

    await pool.query(`DELETE FROM financing_programs WHERE name LIKE 'Test Dispositif%'`);
  });

  it('renvoie plusieurs volets de financement par dispositif, jamais un taux unique (Module 7)', async () => {
    await pool.query(
      `INSERT INTO financing_programs (name, eligibility, source_url, active, eligible_size_categories)
       VALUES ('Test Multi-Volets', 'PME industrielles', 'https://example.ma', true, '{tpe,pme}')`,
    );
    const programId = (await pool.query(`SELECT id FROM financing_programs WHERE name = 'Test Multi-Volets'`)).rows[0].id;
    await pool.query(
      `INSERT INTO financing_program_components (financing_program_id, label, beneficiary_type, subsidy_rate_pct, source, active) VALUES
         ($1, 'Investissement', NULL, 30.00, 'Test', true),
         ($1, 'Conseil et expertise technique', 'PME', 80.00, 'Test', true),
         ($1, 'Conseil et expertise technique', 'TPE', 90.00, 'Test', true)`,
      [programId],
    );
    await pool.query(
      `INSERT INTO financing_program_categories (financing_program_id, label) VALUES ($1, 'Transition énergétique')`,
      [programId],
    );

    const res = await agent.get('/api/financing/programs');
    const program = res.body.programs.find((p) => p.name === 'Test Multi-Volets');
    expect(program.components).toHaveLength(3);
    expect(program.components.map((c) => Number(c.subsidy_rate_pct))).toEqual(expect.arrayContaining([30, 80, 90]));
    expect(program.categories).toEqual(['Transition énergétique']);

    await pool.query(`DELETE FROM financing_programs WHERE name = 'Test Multi-Volets'`);
  });

  it('ne renvoie jamais un volet dont le taux est encore à confirmer (active=false)', async () => {
    await pool.query(
      `INSERT INTO financing_programs (name, eligibility, source_url, active, eligible_size_categories)
       VALUES ('Test Volet Inconfirme', 'PME industrielles', 'https://example.ma', true, '{tpe,pme}')`,
    );
    const programId = (await pool.query(`SELECT id FROM financing_programs WHERE name = 'Test Volet Inconfirme'`)).rows[0].id;
    await pool.query(
      `INSERT INTO financing_program_components (financing_program_id, label, subsidy_rate_pct, source, active) VALUES
         ($1, 'Innovation', NULL, 'PLACEHOLDER — non confirmé', false)`,
      [programId],
    );

    const res = await agent.get('/api/financing/programs');
    const program = res.body.programs.find((p) => p.name === 'Test Volet Inconfirme');
    expect(program.components).toHaveLength(0);

    await pool.query(`DELETE FROM financing_programs WHERE name = 'Test Volet Inconfirme'`);
  });

  it('expose Tatwir Croissance Verte (donnée réelle) avec ses 3 volets confirmés, le volet innovation non confirmé exclu', async () => {
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir).toBeDefined();
    expect(tatwir.components).toHaveLength(3);
    expect(tatwir.components.some((c) => c.label === 'Innovation et développement produit')).toBe(false);
    expect(tatwir.categories).toEqual(
      expect.arrayContaining(['Transition énergétique', 'Filières vertes', 'Innovation éco-conçue', 'Technologies propres']),
    );
  });

  // Bug réel trouvé en vérification manuelle : NULL n'est jamais égal à NULL
  // en SQL, donc UNIQUE(..., beneficiary_type) seul ne détectait pas un
  // doublon sur un volet sans beneficiary_type (ex. "Investissement") —
  // ré-exécuter le seed dupliquait la ligne. Corrigé par un index unique sur
  // COALESCE(beneficiary_type, ''). Ce test ré-exécute le seed réel pour
  // prouver que la régression ne peut plus se reproduire silencieusement.
  it('ré-exécuter le seed financement ne duplique jamais un volet sans beneficiary_type (régression)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const seedPath = path.resolve('src/db/seed/005_financing_programs_tatwir.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf8');

    await pool.query(seedSql);
    await pool.query(seedSql);

    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir.components).toHaveLength(3);
    expect(tatwir.components.filter((c) => c.label === 'Investissement')).toHaveLength(1);
  });

  // "10% apport fonds propres" n'a pas sa propre ligne (hypothèse non
  // confirmée) — rattaché en note au volet Investissement, comme demandé.
  // Vérifie explicitement que l'API expose bien cette note (elle existait en
  // base mais n'était pas sélectionnée par la requête avant ce test).
  // Piste mise à jour : ce n'est peut-être pas un apport en fonds propres
  // exigé de l'entreprise, mais une aide BFR remboursable — toujours rattaché
  // en note au volet Investissement (jamais sa propre ligne), toujours non confirmé.
  it("rattache la nouvelle hypothèse (aide BFR) au volet Investissement, pas comme volet séparé", async () => {
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    const investissement = tatwir.components.find((c) => c.label === 'Investissement');
    expect(investissement).toBeDefined();
    expect(investissement.notes).toMatch(/besoin en fonds de roulement|BFR/i);
    expect(investissement.notes).toMatch(/non confirmée/i);
    expect(tatwir.components.some((c) => c.label.toLowerCase().includes('bfr'))).toBe(false);
  });

  it('rejette sans authentification', async () => {
    const res = await request(app).get('/api/financing/programs');
    expect(res.status).toBe(401);
  });
});

describe('computeCompanySizeCategory — seuils Loi 53-00 (Module 7)', () => {
  it('classe TPE en dessous de 10 salariés, peu importe le CA', () => {
    expect(computeCompanySizeCategory({ headcount: 9, annual_revenue_mad: null })).toEqual({ category: 'tpe', source: 'calcule' });
    expect(computeCompanySizeCategory({ headcount: 3, annual_revenue_mad: 500_000_000 })).toEqual({ category: 'tpe', source: 'calcule' });
  });

  it('classe PME entre 10 et 200 salariés avec un CA sous 75M MAD', () => {
    expect(computeCompanySizeCategory({ headcount: 50, annual_revenue_mad: 74_999_999 })).toEqual({ category: 'pme', source: 'calcule' });
    expect(computeCompanySizeCategory({ headcount: 200, annual_revenue_mad: 75_000_000 })).toEqual({ category: 'pme', source: 'calcule' });
  });

  it('classe GE au-delà de 200 salariés, peu importe le CA', () => {
    expect(computeCompanySizeCategory({ headcount: 201, annual_revenue_mad: 1 })).toEqual({ category: 'ge', source: 'calcule' });
  });

  it("ne tranche pas entre PME et GE si l'effectif est <= 200 mais le CA dépasse le seuil ou est inconnu (le bilan n'est pas collecté)", () => {
    expect(computeCompanySizeCategory({ headcount: 50, annual_revenue_mad: 80_000_000 })).toEqual({ category: null, source: 'indetermine' });
    expect(computeCompanySizeCategory({ headcount: 50, annual_revenue_mad: null })).toEqual({ category: null, source: 'indetermine' });
  });

  it('retombe sur la déclaration si effectif et CA sont tous les deux absents', () => {
    expect(computeCompanySizeCategory({ headcount: null, annual_revenue_mad: null, declared_size_category: 'pme' })).toEqual({ category: 'pme', source: 'declare' });
  });

  it('indique "indetermine" sans jamais deviner si rien n\'est renseigné', () => {
    expect(computeCompanySizeCategory({ headcount: null, annual_revenue_mad: null, declared_size_category: null })).toEqual({ category: null, source: 'indetermine' });
  });
});

describe('GET /api/financing/programs — éligibilité automatique (Module 7)', () => {
  // Tatwir a son propre critère de taille (CA uniquement, confirmé
  // indépendamment via 3 sources) — distinct de la Loi 53-00 générique
  // (effectif + CA) utilisée par défaut pour un programme sans critère propre.
  it('indique Tatwir éligible pour une TPE via son critère programme (CA <= 10 MDH), pas la Loi 53-00', async () => {
    await agent.put('/api/companies/me').send({ annualRevenueMad: 5_000_000, headcount: 500 }); // effectif GE, mais le critère programme ignore l'effectif
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir.companySizeCategory).toBe('tpe');
    expect(tatwir.companySizeCategorySource).toBe('calcule_programme');
    expect(tatwir.eligible).toBe(true);
    expect(res.body.sizeCategoryCaveat).toMatch(/Maroc PME\/AMEE/);
  });

  it('indique Tatwir non éligible pour une grande entreprise (CA > 200 MDH selon le critère programme)', async () => {
    await agent.put('/api/companies/me').send({ annualRevenueMad: 300_000_000 });
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir.companySizeCategory).toBe('ge');
    expect(tatwir.eligible).toBe(false);
  });

  it("indique l'éligibilité Tatwir comme indéterminée (jamais devinée) tant que le CA n'est pas renseigné, même avec un effectif connu", async () => {
    await agent.put('/api/companies/me').send({ headcount: 5 }); // effectif seul ne suffit pas : Tatwir ne regarde que le CA
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir.companySizeCategory).toBeNull();
    expect(tatwir.eligible).toBeNull();
  });

  it('utilise la déclaration de taille en repli quand le CA est absent', async () => {
    await agent.put('/api/companies/me').send({ declaredSizeCategory: 'ge' });
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir.companySizeCategory).toBe('ge');
    expect(tatwir.companySizeCategorySource).toBe('declare');
  });

  it("retombe sur la Loi 53-00 générique pour un programme sans critère de taille propre", async () => {
    await pool.query(
      `INSERT INTO financing_programs (name, eligibility, source_url, active, eligible_size_categories)
       VALUES ('Test Sans Critere Propre', 'PME', 'https://example.ma', true, '{tpe,pme}')`,
    );
    await agent.put('/api/companies/me').send({ headcount: 5 }); // pas de CA, mais l'effectif suffit pour la Loi 53-00
    const res = await agent.get('/api/financing/programs');
    const program = res.body.programs.find((p) => p.name === 'Test Sans Critere Propre');
    expect(program.companySizeCategory).toBe('tpe');
    expect(program.companySizeCategorySource).toBe('calcule_loi5300');

    await pool.query(`DELETE FROM financing_programs WHERE name = 'Test Sans Critere Propre'`);
  });

  it('signale "nouveau" un dispositif récent uniquement pour une entreprise éligible, jamais pour une entreprise non éligible', async () => {
    await agent.put('/api/companies/me').send({ annualRevenueMad: 5_000_000 }); // TPE, éligible
    const resEligible = await agent.get('/api/financing/programs');
    const tatwirEligible = resEligible.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwirEligible.isNew).toBe(true); // seedé récemment

    await agent.put('/api/companies/me').send({ annualRevenueMad: 300_000_000 }); // GE, non éligible
    const resIneligible = await agent.get('/api/financing/programs');
    const tatwirIneligible = resIneligible.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwirIneligible.isNew).toBe(false);
  });

  // Cadrage explicite : alerts_eligible n'est jamais dérivé automatiquement
  // du registre (une règle non confirmée n'exclut pas forcément un
  // programme, ex. Tatwir) — c'est un jugement délibéré par programme. Un
  // programme avec alerts_eligible=false ne signale jamais "Nouveau", même
  // parfaitement éligible en taille et récemment modifié.
  it('ne signale jamais "nouveau" pour un programme avec alerts_eligible=false, même parfaitement éligible', async () => {
    await pool.query(
      `INSERT INTO financing_programs (name, eligibility, source_url, active, eligible_size_categories, alerts_eligible)
       VALUES ('Test Alerts Desactivees', 'PME', 'https://example.ma', true, '{tpe,pme}', false)`,
    );
    await agent.put('/api/companies/me').send({ annualRevenueMad: 5_000_000, declaredSizeCategory: 'tpe' });
    const res = await agent.get('/api/financing/programs');
    const program = res.body.programs.find((p) => p.name === 'Test Alerts Desactivees');
    expect(program.alerts_eligible).toBe(false);
    expect(program.isNew).toBe(false);

    await pool.query(`DELETE FROM financing_programs WHERE name = 'Test Alerts Desactivees'`);
  });

  it("expose l'échéance quand elle est renseignée (aucun mécanisme de rappel, juste l'affichage)", async () => {
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir.application_deadline).toBeNull();
    expect(tatwir.deadline_note).toMatch(/éditions successives/i);
  });

  it('expose les règles vérifiées (registre) et les conditions non automatisées pour Tatwir', async () => {
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir.non_automated_conditions).toMatch(/registre de commerce/i);

    const sizeRule = tatwir.rules.find((r) => r.rule_key === 'size_threshold');
    expect(sizeRule.status).toBe('confirme');
    expect(sizeRule.verified_by).toBe('utilisateur');

    const bfrRule = tatwir.rules.find((r) => r.rule_key === 'bfr_aid_hypothesis');
    expect(bfrRule.status).toBe('non_confirme');
  });

  // PACT'Décarbonation/Eau n'a pas de critère de taille confirmé propre —
  // eligible_size_categories doit rester NULL (jamais "tout le monde
  // éligible" ni "personne éligible" par défaut), donc l'éligibilité reste
  // indéterminée quelle que soit la taille de l'entreprise.
  it("indique PACT'Décarbonation/Eau avec une éligibilité toujours indéterminée (aucun seuil de taille confirmé pour ce programme)", async () => {
    await agent.put('/api/companies/me').send({ annualRevenueMad: 5_000_000, declaredSizeCategory: 'tpe' });
    const res = await agent.get('/api/financing/programs');
    const pact = res.body.programs.find((p) => p.name === "PACT'Décarbonation/Eau");
    expect(pact).toBeDefined();
    expect(pact.eligible).toBeNull();
    expect(pact.components).toHaveLength(1);
    expect(Number(pact.components[0].subsidy_rate_pct)).toBe(80);
    expect(Number(pact.components[0].cap_amount_mad)).toBe(1_000_000);
  });

  // "Bilan carbone" ne doit jamais apparaître comme prestation confirmée —
  // seulement documenté au registre avec le statut "à confirmer", exactement
  // la consigne donnée pour ce point précis.
  it('ne présente jamais "bilan carbone" comme une prestation confirmée de PACT\'Décarbonation/Eau', async () => {
    const res = await agent.get('/api/financing/programs');
    const pact = res.body.programs.find((p) => p.name === "PACT'Décarbonation/Eau");
    expect(pact.components.some((c) => c.label.toLowerCase().includes('bilan carbone'))).toBe(false);

    const bilanRule = pact.rules.find((r) => r.rule_key === 'bilan_carbone_named_service');
    expect(bilanRule.status).toBe('a_confirmer');
    expect(bilanRule.verified_by).toBe('claude_code');
  });
});

describe('Recommandations personnalisées (Module 7)', () => {
  // Le bug précis signalé : le taux mis en avant doit correspondre à la
  // VRAIE catégorie de l'entreprise (PME -> 80%, TPE -> 90% pour Tatwir),
  // jamais le taux maximum du programme toutes catégories confondues.
  it('recommande le taux qui correspond à la catégorie réelle de l\'entreprise, pas le taux maximum du programme', async () => {
    await agent.put('/api/companies/me').send({ annualRevenueMad: 50_000_000 }); // PME selon le critère Tatwir (10-200 MDH)
    const resPme = await agent.get('/api/financing/programs');
    const tatwirPme = resPme.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwirPme.companySizeCategory).toBe('pme');
    expect(tatwirPme.bestApplicableRatePct).toBe(80);
    expect(tatwirPme.recommendationReason).toMatch(/80%/);
    expect(tatwirPme.recommendationReason).not.toMatch(/90%/);

    await agent.put('/api/companies/me').send({ annualRevenueMad: 5_000_000 }); // TPE selon le critère Tatwir (<= 10 MDH)
    const resTpe = await agent.get('/api/financing/programs');
    const tatwirTpe = resTpe.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwirTpe.companySizeCategory).toBe('tpe');
    expect(tatwirTpe.bestApplicableRatePct).toBe(90);
    expect(tatwirTpe.recommendationReason).toMatch(/90%/);
    expect(tatwirTpe.recommendationReason).not.toMatch(/80%/);
  });

  it('classe les dispositifs en 3 niveaux (éligible, non déterminé, non éligible) et trie le niveau éligible par taux applicable décroissant', async () => {
    // Une entreprise PME (Tatwir) : Tatwir en tier 1 (éligible, 80%),
    // PACT toujours en tier 2 (aucun critère de taille confirmé pour ce programme).
    await agent.put('/api/companies/me').send({ annualRevenueMad: 50_000_000 });
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    const pact = res.body.programs.find((p) => p.name === "PACT'Décarbonation/Eau");
    expect(tatwir.tier).toBe(1);
    expect(pact.tier).toBe(2);
    // Tatwir (éligible) doit apparaître avant PACT (non déterminé) dans la liste triée.
    expect(res.body.programs.indexOf(tatwir)).toBeLessThan(res.body.programs.indexOf(pact));
  });

  it("indique pour PACT'Décarbonation/Eau une raison explicite d'instabilité, pas le message générique de donnée manquante", async () => {
    const res = await agent.get('/api/financing/programs');
    const pact = res.body.programs.find((p) => p.name === "PACT'Décarbonation/Eau");
    expect(pact.eligible).toBeNull();
    expect(pact.undeterminedReason).toMatch(/Pacte TPME/);
    expect(pact.undeterminedReason).not.toMatch(/^Aucun critère de taille confirmé pour ce dispositif à ce jour\.$/);
  });

  it('utilise le message générique de donnée manquante pour un programme sans raison personnalisée (Tatwir, CA non renseigné)', async () => {
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir.eligible).toBeNull();
    expect(tatwir.undeterminedReason).toMatch(/Renseignez le chiffre d'affaires/);
  });

  it('classe correctement les règles du registre par type (critère d\'éligibilité vs exclusion vs autre)', async () => {
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    expect(tatwir.rules.find((r) => r.rule_key === 'size_threshold').rule_type).toBe('critere_eligibilite');
    expect(tatwir.rules.find((r) => r.rule_key === 'transparency_condition').rule_type).toBe('exclusion');
    expect(tatwir.rules.find((r) => r.rule_key === 'bfr_aid_hypothesis').rule_type).toBe('autre');
  });

  it("expose current_edition_label structurellement (NULL tant qu'aucune édition en cours n'est confirmée fraîchement)", async () => {
    const res = await agent.get('/api/financing/programs');
    const tatwir = res.body.programs.find((p) => p.name === 'Tatwir Croissance Verte');
    // La dernière édition connue (2022) est trop ancienne pour être présentée
    // comme "en cours" aujourd'hui — jamais une donnée périmée affichée comme actuelle.
    expect(tatwir.current_edition_label).toBeNull();
  });
});

describe('GET /api/financing/carbon-tax/parameters', () => {
  it('indique available:false tant qu’aucun taux n’est configuré (aucun taux inventé)', async () => {
    const res = await agent.get('/api/financing/carbon-tax/parameters');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });

  it('renvoie les paramètres une fois configurés, y compris le périmètre taxable', async () => {
    await pool.query(
      `INSERT INTO carbon_tax_parameters (rate_per_tco2e, threshold_tco2e, taxable_scopes, source, valid_from)
       VALUES (150.00, 500, '{1,2}', 'Test LF2026', '2024-01-01')`,
    );
    const res = await agent.get('/api/financing/carbon-tax/parameters');
    expect(res.body.available).toBe(true);
    expect(res.body.ratePerTco2e).toBe(150);
    expect(res.body.thresholdTco2e).toBe(500);
    expect(res.body.taxableScopes).toEqual([1, 2]);

    await pool.query(`DELETE FROM carbon_tax_parameters WHERE source = 'Test LF2026'`);
  });
});

describe('GET /api/financing/carbon-tax/simulate', () => {
  it('renvoie déjà le détail par scope même sans taux/périmètre configuré (pas un vide silencieux)', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });

    const res = await agent.get('/api/financing/carbon-tax/simulate');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    // Le détail est déjà là, mais aucun total pré-sommé n'est renvoyé tant
    // que le périmètre taxable n'est pas explicitement configuré — ne
    // présuppose aucune combinaison de scopes.
    expect(res.body.breakdown.scope1Tco2e).toBeCloseTo(0.268, 6);
    expect(res.body.totalTco2eConsidered).toBeUndefined();
  });

  describe('avec des paramètres configurés', () => {
    afterEach(async () => {
      await pool.query(`DELETE FROM carbon_tax_parameters WHERE source LIKE 'Test%'`);
    });

    it('calcule le montant estimé au-dessus du seuil (périmètre Scope 1+2)', async () => {
      await pool.query(
        `INSERT INTO carbon_tax_parameters (rate_per_tco2e, threshold_tco2e, taxable_scopes, source, valid_from)
         VALUES (150.00, 0.1, '{1,2}', 'Test LF2026', '2024-01-01')`,
      );
      await agent.post('/api/activity-entries/energie').send({
        siteId,
        periodStart: '2024-01-01',
        periodEnd: '2024-01-31',
        factorCode: 'diesel_L',
        quantity: 100, // 0.268 tCO2e
      });

      const res = await agent.get('/api/financing/carbon-tax/simulate');
      expect(res.body.available).toBe(true);
      expect(res.body.taxableScopes).toEqual([1, 2]);
      expect(res.body.aboveThreshold).toBe(true);
      expect(res.body.estimatedTaxMad).toBeCloseTo(0.268 * 150, 6);
    });

    it('renvoie un montant à 0 (réel, pas "non calculé") sous le seuil', async () => {
      await pool.query(
        `INSERT INTO carbon_tax_parameters (rate_per_tco2e, threshold_tco2e, taxable_scopes, source, valid_from)
         VALUES (150.00, 1000, '{1,2}', 'Test LF2026', '2024-01-01')`,
      );
      await agent.post('/api/activity-entries/energie').send({
        siteId,
        periodStart: '2024-01-01',
        periodEnd: '2024-01-31',
        factorCode: 'diesel_L',
        quantity: 100,
      });

      const res = await agent.get('/api/financing/carbon-tax/simulate');
      expect(res.body.available).toBe(true);
      expect(res.body.aboveThreshold).toBe(false);
      expect(res.body.estimatedTaxMad).toBe(0);
    });

    it("le périmètre taxable n'est pas figé dans le code : Scope 1 seul exclut le Scope 2, même avec des données Scope 2", async () => {
      await pool.query(
        `INSERT INTO carbon_tax_parameters (rate_per_tco2e, threshold_tco2e, taxable_scopes, source, valid_from)
         VALUES (100.00, NULL, '{1}', 'Test LF2026', '2024-01-01')`,
      );
      await agent.post('/api/activity-entries/energie').send({
        siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100, // Scope 1 : 0.268 tCO2e
      });
      await agent.post('/api/activity-entries/energie').send({
        siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'electricity_ma_location_based_kwh', quantity: 1000, // Scope 2 : 0.644 tCO2e
      });

      const res = await agent.get('/api/financing/carbon-tax/simulate');
      expect(res.body.taxableScopes).toEqual([1]);
      expect(res.body.totalTco2eConsidered).toBeCloseTo(0.268, 6); // exclut les 0.644 du Scope 2
    });

    it('le périmètre taxable peut explicitement inclure le Scope 3 si configuré ainsi (jamais exclu par défaut dans le code)', async () => {
      await pool.query(
        `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from)
         VALUES ('scope3_ratio_metallurgie', 'Ratio test', 3, 'scope3_ratio', 'k€', 200, 'Test ADEME', false, 'MA', '2024-01-01')`,
      );
      await pool.query(
        `INSERT INTO exchange_rates (base_currency, quote_currency, rate, source, valid_from)
         VALUES ('EUR', 'MAD', 10, 'Test rate', '2024-01-01')`,
      );
      await agent.post('/api/calculations/scope3/estimate').send({
        periodStart: '2024-01-01', periodEnd: '2024-12-31', amountMad: 1000000,
      }); // 100 k€ × 200 / 1000 = 20 tCO2e

      await pool.query(
        `INSERT INTO carbon_tax_parameters (rate_per_tco2e, threshold_tco2e, taxable_scopes, source, valid_from)
         VALUES (100.00, NULL, '{1,2,3}', 'Test LF2026', '2024-01-01')`,
      );

      const res = await agent.get('/api/financing/carbon-tax/simulate');
      expect(res.body.taxableScopes).toEqual([1, 2, 3]);
      expect(res.body.totalTco2eConsidered).toBeCloseTo(20, 6);

      await pool.query(`DELETE FROM activity_entries WHERE factor_code LIKE 'scope3_ratio_%'`);
      await pool.query(`DELETE FROM emission_factors WHERE source = 'Test ADEME'`);
      await pool.query(`DELETE FROM exchange_rates WHERE source = 'Test rate'`);
    });
  });
});

describe('Isolation multi-tenant — financing', () => {
  it("le simulateur de l'entreprise B ne reflète jamais les émissions de l'entreprise A", async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 1000, // gros volume, facile à repérer si fuite
    });

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send({
      companyName: 'AutoParts Maroc SA',
      sector: 'automobile',
      email: 'b@autoparts.ma',
      password: 'mot-de-passe-solide-B1',
    });

    const simulateB = await agentB.get('/api/financing/carbon-tax/simulate');
    expect(simulateB.body.breakdown.scope1Tco2e).toBe(0);
  });

  it('rejette /api/financing/carbon-tax/simulate sans authentification', async () => {
    const res = await request(app).get('/api/financing/carbon-tax/simulate');
    expect(res.status).toBe(401);
  });
});
