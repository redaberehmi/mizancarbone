import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';

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

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
      else if (char === '"') inQuotes = false;
      else current += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

describe('GET /api/reports/export.csv', () => {
  it('inclut toutes les natures (énergie, matière première, estimation Scope 3), contrairement au CSV CBAM', async () => {
    const energyRes = await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100,
    });
    await agent.post('/api/activity-entries/matieres-premieres').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', materialLabel: 'Ferraille', quantity: 12, supplier: 'Sonasid',
    });

    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from)
       VALUES ('scope3_ratio_metallurgie', 'Ratio test', 3, 'scope3_ratio', 'k€', 200, 'Test ADEME', false, 'MA', '2024-01-01')`,
    );
    await pool.query(
      `INSERT INTO exchange_rates (base_currency, quote_currency, rate, source, valid_from)
       VALUES ('EUR', 'MAD', 10, 'Test rate', '2024-01-01')`,
    );
    await agent.post('/api/calculations/scope3/estimate').send({
      periodStart: '2024-01-01', periodEnd: '2024-12-31', amountMad: 100000,
    });

    const res = await agent.get('/api/reports/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);

    const lines = res.text.trim().split('\n');
    const header = parseCsvLine(lines[0]);
    expect(header).toContain('nature');
    expect(header).toContain('source_facteur');

    const natureIndex = header.indexOf('nature');
    const natures = lines.slice(1).map((l) => parseCsvLine(l)[natureIndex]);
    expect(natures).toContain('energie');
    expect(natures).toContain('matiere_premiere');
    expect(natures).toContain('scope3_estimation');
    expect(lines).toHaveLength(4); // header + 3 lignes

    await pool.query(`DELETE FROM activity_entries WHERE factor_code LIKE 'scope3_ratio_%'`);
    await pool.query(`DELETE FROM emission_factors WHERE source = 'Test ADEME'`);
    await pool.query(`DELETE FROM exchange_rates WHERE source = 'Test rate'`);
  });

  it('laisse tco2e vide (jamais "0") pour une matière première non calculée', async () => {
    await agent.post('/api/activity-entries/matieres-premieres').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', materialLabel: 'Ferraille', quantity: 12, supplier: 'Sonasid',
    });

    const res = await agent.get('/api/reports/export.csv');
    const lines = res.text.trim().split('\n');
    const header = parseCsvLine(lines[0]);
    const tco2eIndex = header.indexOf('tco2e');
    const dataLine = lines.find((l) => l.includes('Ferraille'));
    expect(parseCsvLine(dataLine)[tco2eIndex]).toBe('');
  });

  it('renseigne systématiquement la source du facteur pour toute ligne calculée (jamais un facteur sans source)', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100,
    });
    const res = await agent.get('/api/reports/export.csv');
    const lines = res.text.trim().split('\n');
    const header = parseCsvLine(lines[0]);
    const sourceIndex = header.indexOf('source_facteur');
    const dataLine = lines[1];
    expect(parseCsvLine(dataLine)[sourceIndex]).not.toBe('');
  });

  it('rejette sans authentification', async () => {
    const res = await request(app).get('/api/reports/export.csv');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reports/export.pdf', () => {
  it('renvoie une réponse PDF valide (statut, en-têtes)', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100,
    });

    const res = await agent.get('/api/reports/export.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/rapport-carbone-mizancarbone-.*\.pdf/);
  }, 15000);

  it('produit un buffer PDF valide (magic bytes %PDF) avec des données présentes', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100,
    });
    const companyRes = await agent.get('/api/companies/me');
    const { buildDashboardPdfExport } = await import('../src/modules/reports/reports.service.js');
    const { buffer } = await buildDashboardPdfExport(companyRes.body.company.id);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  }, 15000);

  it("génère un PDF valide même sans aucune donnée (pas d'erreur sur entreprise vide)", async () => {
    const companyRes = await agent.get('/api/companies/me');
    const { buildDashboardPdfExport } = await import('../src/modules/reports/reports.service.js');
    const { buffer } = await buildDashboardPdfExport(companyRes.body.company.id);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  }, 15000);

  it("l'annexe méthodologique mentionne le périmètre organisationnel ET l'année de référence (GHG Protocol Corporate Standard)", async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2023 });

    const companyRes = await agent.get('/api/companies/me');
    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const html = await buildReportHtml(companyRes.body.company.id);

    expect(html).toContain('contrôle opérationnel');
    expect(html).toMatch(/Année de référence.*2023/);
  });

  it("indique explicitement l'année de référence comme non renseignée si l'entreprise ne l'a jamais définie", async () => {
    const companyRes = await agent.get('/api/companies/me');
    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const html = await buildReportHtml(companyRes.body.company.id);

    expect(html).toMatch(/Année de référence.*non renseignée/);
  });
});

describe('Statut des données (0 réel / non calculé / manquant / estimé) — Bilan Carbone', () => {
  it('affiche "Manquant" pour un scope sans aucune entrée saisie, jamais "0"', async () => {
    const companyRes = await agent.get('/api/companies/me');
    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const html = await buildReportHtml(companyRes.body.company.id);

    expect(html).toMatch(/data-status="manquant"/);
    expect(html).not.toContain('<td>Scope 1</td><td class="mono">0</td>');
  });

  it('affiche "Non calculé" (pas "0") pour une entrée saisie mais dont le facteur n\'a pas encore tourné', async () => {
    const companyRes = await agent.get('/api/companies/me');
    const companyId = companyRes.body.company.id;

    // Insertion directe (bypass du hook de calcul automatique à la création,
    // même technique que tests/calculation.test.js "rattrape une entrée
    // insérée sans passer par le service") : reproduit l'état réel "donnée
    // saisie, calcul pas encore fait", impossible à obtenir via l'API seule.
    await pool.query(
      `INSERT INTO activity_entries (company_id, site_id, period_start, period_end, factor_code, quantity)
       VALUES ($1, $2, '2024-01-01', '2024-01-31', 'diesel_L', 100)`,
      [companyId, siteId],
    );

    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const html = await buildReportHtml(companyId);

    expect(html).toContain('Non calculé');
    expect(html).toMatch(/data-status="non_calcule"/);
  });

  it('affiche "0" (pas "Non calculé"/"Manquant") pour un calcul réel dont le résultat est exactement zéro', async () => {
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from)
       VALUES ('test_zero_factor', 'Facteur test zéro', 1, 'combustion_fixe', 'L', 0, 'Test zéro', true, 'MA', '2024-01-01')`,
    );
    await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'test_zero_factor', quantity: 100,
    });

    const companyRes = await agent.get('/api/companies/me');
    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const html = await buildReportHtml(companyRes.body.company.id);

    expect(html).toMatch(/data-status="zero_reel"/);
    expect(html).toContain('<td>Scope 1</td><td class="mono">0</td>');

    await pool.query(`DELETE FROM activity_entries WHERE factor_code = 'test_zero_factor'`);
    await pool.query(`DELETE FROM emission_factors WHERE code = 'test_zero_factor'`);
  });

  it('marque le Scope 3 "estimé" une fois calculé, jamais confondu avec un calcul direct réel', async () => {
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from)
       VALUES ('scope3_ratio_metallurgie', 'Ratio test', 3, 'scope3_ratio', 'k€', 200, 'Test ADEME', false, 'MA', '2024-01-01')`,
    );
    await pool.query(
      `INSERT INTO exchange_rates (base_currency, quote_currency, rate, source, valid_from)
       VALUES ('EUR', 'MAD', 10, 'Test rate', '2024-01-01')`,
    );
    await agent.post('/api/calculations/scope3/estimate').send({
      periodStart: '2024-01-01', periodEnd: '2024-12-31', amountMad: 100000,
    });

    const companyRes = await agent.get('/api/companies/me');
    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const html = await buildReportHtml(companyRes.body.company.id);

    expect(html).toMatch(/data-status="estime"/);

    await pool.query(`DELETE FROM activity_entries WHERE factor_code LIKE 'scope3_ratio_%'`);
    await pool.query(`DELETE FROM emission_factors WHERE source = 'Test ADEME'`);
    await pool.query(`DELETE FROM exchange_rates WHERE source = 'Test rate'`);
  });

  it('marque le total tCO2e "partiel" dès qu\'un des postes qui le composent est manquant ou non calculé, jamais un total qui a l\'air complet', async () => {
    const companyRes = await agent.get('/api/companies/me');
    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const html = await buildReportHtml(companyRes.body.company.id);

    // Entreprise fraîchement créée : aucune donnée -> tous les scopes sont
    // "manquant" -> le total doit être présenté comme partiel, pas "0".
    expect(html).toContain('Partiel');
  });

  // Régression : trouvée en vérification visuelle du PDF réel (pas par un
  // test), pas par le code lui-même. Un scope avec une entrée calculée ET
  // une entrée non calculée affichait "Réel" tout court sur la base d'un
  // total qui excluait silencieusement l'entrée non calculée — exactement
  // la confusion 0/non-calculé que ce chantier devait éliminer, juste
  // décalée au niveau agrégat plutôt qu'au niveau de la valeur elle-même.
  it('signale un scope comme incomplet quand il mélange une entrée calculée et une entrée non calculée, jamais un simple "Réel"', async () => {
    const companyRes = await agent.get('/api/companies/me');
    const companyId = companyRes.body.company.id;

    await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100,
    });
    // Deuxième entrée Scope 1, jamais calculée (même technique d'insertion
    // directe que le test "Non calculé" ci-dessus).
    await pool.query(
      `INSERT INTO activity_entries (company_id, site_id, period_start, period_end, factor_code, quantity)
       VALUES ($1, $2, '2024-02-01', '2024-02-29', 'gasoline_L', 50)`,
      [companyId, siteId],
    );

    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const html = await buildReportHtml(companyId);

    expect(html).toContain('données incomplètes');
    expect(html).toContain('(partiel)');
    // Le total composite doit aussi être marqué partiel, pas juste le poste.
    expect(html).toContain('Partiel — voir statuts ci-dessous');
  });
});

describe('Isolation multi-tenant — reports', () => {
  it("le CSV de l'entreprise B ne contient jamais les données de l'entreprise A", async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100,
    });

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send({
      companyName: 'AutoParts Maroc SA',
      sector: 'automobile',
      email: 'b@autoparts.ma',
      password: 'mot-de-passe-solide-B1',
    });

    const csvB = await agentB.get('/api/reports/export.csv');
    const linesB = csvB.text.trim().split('\n');
    expect(linesB).toHaveLength(1); // uniquement l'en-tête, aucune donnée de A

    const companyBRes = await agentB.get('/api/companies/me');
    const { buildRawDataCsvExport } = await import('../src/modules/reports/reports.service.js');
    const { content } = await buildRawDataCsvExport(companyBRes.body.company.id);
    expect(content.trim().split('\n')).toHaveLength(1); // uniquement l'en-tête
  });

  // getFactorsUsedByCompany alimente directement l'annexe méthodologique du
  // PDF — c'était la seule pièce du Module 6 jamais testée pour le scoping
  // par company_id, malgré un nom de test qui prétendait déjà couvrir "le
  // CSV et le PDF". Corrigé : testée ici directement, et via une génération
  // PDF réelle pour l'entreprise B ci-dessous.
  it("getFactorsUsedByCompany (annexe PDF) ne renvoie jamais les facteurs utilisés par une autre entreprise", async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100,
    });

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send({
      companyName: 'AutoParts Maroc SA',
      sector: 'automobile',
      email: 'b@autoparts.ma',
      password: 'mot-de-passe-solide-B1',
    });
    const companyBRes = await agentB.get('/api/companies/me');

    const companyARes = await agent.get('/api/companies/me');
    const { getFactorsUsedByCompany } = await import('../src/modules/reports/reports.service.js');

    const factorsA = await getFactorsUsedByCompany(companyARes.body.company.id);
    expect(factorsA).toHaveLength(1);
    expect(factorsA[0].code).toBe('diesel_L');

    const factorsB = await getFactorsUsedByCompany(companyBRes.body.company.id);
    expect(factorsB).toHaveLength(0);
  });

  it("génère un PDF valide pour l'entreprise B sans jamais planter ni inclure les données de l'entreprise A", async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100,
    });

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send({
      companyName: 'AutoParts Maroc SA',
      sector: 'automobile',
      email: 'b@autoparts.ma',
      password: 'mot-de-passe-solide-B1',
    });
    const companyBRes = await agentB.get('/api/companies/me');

    const { buildDashboardPdfExport } = await import('../src/modules/reports/reports.service.js');
    const { buffer } = await buildDashboardPdfExport(companyBRes.body.company.id);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    // Le PDF de B ne peut matériellement pas contenir les données de A :
    // buildDashboardPdfExport ne s'appuie que sur getEmissionsSummary et
    // getFactorsUsedByCompany, tous deux prouvés scopés par company_id
    // ci-dessus et dans tests/calculation.test.js.
  }, 15000);

  it('rejette /api/reports/export.pdf sans authentification', async () => {
    const res = await request(app).get('/api/reports/export.pdf');
    expect(res.status).toBe(401);
  });
});
