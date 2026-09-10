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

describe('GET /api/financing/programs', () => {
  it('renvoie une liste vide tant qu’aucun dispositif n’est renseigné (aucun fabriqué)', async () => {
    const res = await agent.get('/api/financing/programs');
    expect(res.status).toBe(200);
    expect(res.body.programs).toEqual([]);
  });

  it('renvoie les dispositifs actifs, exclut les inactifs', async () => {
    await pool.query(
      `INSERT INTO financing_programs (name, description, subsidy_rate, cap_amount_mad, eligibility, source_url, active)
       VALUES ('Test Dispositif Actif', 'Description test', 50.00, 1000000, 'PME industrielles', 'https://example.ma', true)`,
    );
    await pool.query(
      `INSERT INTO financing_programs (name, active) VALUES ('Test Dispositif Inactif', false)`,
    );

    const res = await agent.get('/api/financing/programs');
    expect(res.status).toBe(200);
    expect(res.body.programs).toHaveLength(1);
    expect(res.body.programs[0].name).toBe('Test Dispositif Actif');
    expect(Number(res.body.programs[0].subsidy_rate)).toBe(50);

    await pool.query(`DELETE FROM financing_programs WHERE name LIKE 'Test Dispositif%'`);
  });

  it('rejette sans authentification', async () => {
    const res = await request(app).get('/api/financing/programs');
    expect(res.status).toBe(401);
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
