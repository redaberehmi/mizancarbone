import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';

// Cadrage explicite (demande utilisateur) : une même donnée source ne doit
// jamais s'afficher avec une valeur, une unité ou un facteur différents
// selon qu'elle apparaît dans le Bilan Carbone ou dans la Préparation CBAM.
// Les deux services partagent déjà la même table emission_factors et le
// même helper de formatage (report-formatting.js) — ce test vérifie que
// cette garantie tient au niveau du HTML réellement généré, pas seulement
// au niveau du code partagé.
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

describe('Cohérence entre les deux rapports (Bilan Carbone / Préparation CBAM)', () => {
  it('une même entrée énergie affiche la même valeur tCO2e, la même unité et la même source de facteur dans les deux rapports', async () => {
    const entryRes = await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100,
    });
    await agent
      .patch(`/api/activity-entries/${entryRes.body.entry.id}/product-allocation`)
      .send({ productAllocation: 'Bobines acier' });

    const companyRes = await agent.get('/api/companies/me');
    const companyId = companyRes.body.company.id;

    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const { buildPreparationReportHtml } = await import('../src/modules/cbam-prep/cbam-prep.service.js');

    const bilanHtml = await buildReportHtml(companyId);
    const cbamHtml = await buildPreparationReportHtml(companyId);

    // Valeur : 100 L × 2.68 kgCO2e/L / 1000 = 0.268 tCO2e, formatée en
    // fr-FR (virgule) par le même helper formatTco2e dans les deux rapports.
    expect(bilanHtml).toContain('0,268');
    expect(cbamHtml).toContain('0,268');

    // Source du facteur : provient de la même colonne emission_factors.source
    // dans les deux requêtes SQL (getFactorsUsedByCompany / getPreparationEntries)
    // — jamais reformulée différemment d'un rapport à l'autre.
    const factorSource = 'Facteur standard GHG Protocol/IEA — À REMPLACER par facteur Outil Bilan Carbone Maroc dès disponible';
    expect(bilanHtml).toContain(factorSource);
    expect(cbamHtml).toContain(factorSource);

    // Unité : 'L' dans les deux (même colonne emission_factors.unit).
    expect(bilanHtml).toContain('kgCO2e/L');
    expect(cbamHtml).toContain('100 L');
  });

  it('une entrée sans facteur calculable affiche "Non calculé" dans les deux rapports, jamais "0" dans l\'un et un texte différent dans l\'autre', async () => {
    const { pool } = await import('../src/config/db.js');
    const companyRes = await agent.get('/api/companies/me');
    const companyId = companyRes.body.company.id;

    await pool.query(
      `INSERT INTO activity_entries (company_id, site_id, period_start, period_end, factor_code, quantity)
       VALUES ($1, $2, '2024-01-01', '2024-01-31', 'diesel_L', 100)`,
      [companyId, siteId],
    );

    const { buildReportHtml } = await import('../src/modules/reports/reports.service.js');
    const { buildPreparationReportHtml } = await import('../src/modules/cbam-prep/cbam-prep.service.js');

    const bilanHtml = await buildReportHtml(companyId);
    const cbamHtml = await buildPreparationReportHtml(companyId);

    expect(bilanHtml).toContain('Non calculé');
    expect(cbamHtml).toContain('Non calculé');
  });
});
