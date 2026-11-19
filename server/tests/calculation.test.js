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

describe('Calcul automatique Scope 1/2 à la création d\'une entrée', () => {
  it('calcule immédiatement le résultat (diesel : 100 L × 2.68 kg/L = 0.268 tCO2e)', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });

    const summary = await agent.get('/api/calculations/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.scope1Tco2e).toBeCloseTo(0.268, 6);
  });

  it('agrège aussi par période et par produit (non alloué tant que le Module 4 ne renseigne rien)', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-02-01',
      periodEnd: '2024-02-29',
      factorCode: 'diesel_L',
      quantity: 50,
    });

    const summary = await agent.get('/api/calculations/summary');
    expect(summary.body.byPeriod).toHaveLength(2);
    const jan = summary.body.byPeriod.find((p) => p.periodStart === '2024-01-01');
    const feb = summary.body.byPeriod.find((p) => p.periodStart === '2024-02-01');
    expect(jan.totalTco2e).toBeCloseTo(0.268, 6);
    expect(feb.totalTco2e).toBeCloseTo((50 * 2.68) / 1000, 6);

    expect(summary.body.byProduct).toHaveLength(1);
    expect(summary.body.byProduct[0].productAllocation).toBeNull();
    expect(summary.body.byProduct[0].totalTco2e).toBeCloseTo(0.268 + (50 * 2.68) / 1000, 6);
  });

  it('Scope 2 location-based alimenté, market-based identique par défaut', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'electricity_ma_location_based_kwh',
      quantity: 1000,
    });

    const summary = await agent.get('/api/calculations/summary');
    expect(summary.body.scope2LocationBasedTco2e).toBeCloseTo(0.644, 6);
    expect(summary.body.scope2MarketBasedTco2e).toBeCloseTo(0.644, 6);
    expect(summary.body.scope2MarketBasedIsDefaulted).toBe(true);
  });

  // Facteurs de production (seed 008) désactivés par le seed 009 : le calcul
  // market-based actuel rend les deux totaux Scope 2 incomplets en situation
  // mixte. Ils ne doivent être ni proposés à la saisie, ni utilisables.
  it('les facteurs de production électrique (market-based) sont désactivés : ni proposés, ni utilisables', async () => {
    const factors = await agent.get('/api/activity-entries/factors');
    const codes = factors.body.factors.map((f) => f.code);
    expect(codes.some((c) => c.startsWith('electricity_production_'))).toBe(false);

    const res = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
      factorCode: 'electricity_production_eolien_kwh',
      quantity: 500,
    });
    expect(res.status).toBe(400);

    const summary = await agent.get('/api/calculations/summary');
    expect(summary.body.scope2MarketBasedIsDefaulted).toBe(true);
  });

  it("n'attribue aucun résultat à une entrée matière première (jamais de facteur inventé)", async () => {
    await agent.post('/api/activity-entries/matieres-premieres').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      materialLabel: 'Bobines acier',
      quantity: 5,
    });

    const summary = await agent.get('/api/calculations/summary');
    expect(summary.body.scope1Tco2e).toBe(0);
    expect(summary.body.scope2LocationBasedTco2e).toBe(0);
  });
});

describe('POST /api/calculations/run', () => {
  it('est idempotent : rien à recalculer après la création automatique', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });

    const run = await agent.post('/api/calculations/run').send({});
    expect(run.body.calculated).toBe(0);
  });

  it('rattrape une entrée insérée sans passer par le service (donnée historique)', async () => {
    const companyRes = await agent.get('/api/companies/me');
    const companyId = companyRes.body.company.id;

    await pool.query(
      `INSERT INTO activity_entries (company_id, site_id, period_start, period_end, factor_code, quantity)
       VALUES ($1, $2, '2024-01-01', '2024-01-31', 'gasoline_L', 50)`,
      [companyId, siteId],
    );

    const before = await agent.get('/api/calculations/summary');
    expect(before.body.scope1Tco2e).toBe(0);

    const run = await agent.post('/api/calculations/run').send({});
    expect(run.body.calculated).toBe(1);

    const after = await agent.get('/api/calculations/summary');
    expect(after.body.scope1Tco2e).toBeCloseTo((50 * 2.31) / 1000, 6);
  });
});

describe('Sélection du facteur selon la période (pas seulement "valid_to IS NULL")', () => {
  // Simule un reversionnement réel : l'ancienne valeur du diesel (2.68,
  // seedée avec valid_to=NULL) devient "historique" (valid_to fixé), une
  // nouvelle version (5.0) devient "courante" à partir de 2025.
  async function reversionDiesel() {
    await pool.query(
      `UPDATE emission_factors SET valid_to = '2024-12-31' WHERE code = 'diesel_L' AND valid_from = '2024-01-01'`,
    );
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from)
       VALUES ('diesel_L', 'Gasoil / Diesel routier (v2 test)', 1, 'combustion_mobile', 'L', 5.0, 'Test reversion', false, 'MA', '2025-01-01')`,
    );
  }

  afterEach(async () => {
    // Les activity_entries/emission_results créées par ces tests (via de
    // vrais appels API) référencent les lignes de facteur de test — il faut
    // les supprimer en premier (cascade sur emission_results), sinon la
    // suppression du facteur échoue sur la contrainte FK.
    await pool.query(`DELETE FROM activity_entries WHERE factor_code = 'diesel_L'`);
    await pool.query(`DELETE FROM emission_factors WHERE code = 'diesel_L' AND valid_from IN ('2025-01-01', '2024-09-01')`);
    await pool.query(`UPDATE emission_factors SET valid_to = NULL WHERE code = 'diesel_L' AND valid_from = '2024-01-01'`);
  });

  it('un backfill sur une entrée passée utilise la version qui était valide à cette période, pas la plus récente', async () => {
    await reversionDiesel();
    const companyRes = await agent.get('/api/companies/me');
    const companyId = companyRes.body.company.id;

    // Entrée historique pour janvier 2024, insérée APRÈS le reversionnement
    // (donc "valid_to IS NULL" pointerait à tort vers la version 2025 si on
    // ne filtrait pas par période).
    await pool.query(
      `INSERT INTO activity_entries (company_id, site_id, period_start, period_end, factor_code, quantity)
       VALUES ($1, $2, '2024-01-01', '2024-01-31', 'diesel_L', 100)`,
      [companyId, siteId],
    );

    const run = await agent.post('/api/calculations/run').send({});
    expect(run.body.calculated).toBe(1);

    const summary = await agent.get('/api/calculations/summary');
    // 100 × 2.68 / 1000 = 0.268 (version 2024, correcte) — PAS 100 × 5.0 / 1000 = 0.5
    expect(summary.body.scope1Tco2e).toBeCloseTo(0.268, 6);
  });

  it('une saisie en temps réel sur une période récente utilise bien la nouvelle version', async () => {
    await reversionDiesel();

    const res = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2025-01-15',
      periodEnd: '2025-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    expect(res.status).toBe(201);

    const summary = await agent.get('/api/calculations/summary');
    // 100 × 5.0 / 1000 = 0.5 (version 2025)
    expect(summary.body.scope1Tco2e).toBeCloseTo(0.5, 6);
  });

  it('refuse (400) une saisie sur une période sans aucune version valide (vrai trou), message "aucun facteur disponible"', async () => {
    // valid_to=2024-12-31 sur l'ancienne, valid_from=2025-01-01 sur la
    // nouvelle : mars 2024... est en fait couvert par l'ancienne (valid_to
    // 2024-12-31). On force un vrai trou en resserrant l'ancienne version.
    await pool.query(
      `UPDATE emission_factors SET valid_to = '2024-06-30' WHERE code = 'diesel_L' AND valid_from = '2024-01-01'`,
    );
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from)
       VALUES ('diesel_L', 'Gasoil / Diesel routier (v2 test)', 1, 'combustion_mobile', 'L', 5.0, 'Test reversion', false, 'MA', '2024-09-01')`,
    );

    const res = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-07-15', // dans le trou entre les deux versions
      periodEnd: '2024-07-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    expect(res.status).toBe(400);
    // Vrai trou : aucune version ne chevauche même partiellement -> message
    // "non disponible", PAS le message de scission (rien à scinder ici).
    expect(res.body.error).toMatch(/aucune version.*n'est disponible/i);
    expect(res.body.error).not.toMatch(/scindez/i);
  });

  it("refuse (400) une saisie dont la période traverse un changement de version, avec un message qui dit explicitement de scinder l'entrée", async () => {
    // Deux versions contiguës (aucun trou : l'ancienne s'arrête le
    // 2024-12-31, la nouvelle démarre le 2025-01-01), mais l'entrée
    // ci-dessous couvre les deux — aucune des deux ne la couvre en entier.
    await reversionDiesel();

    const res = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-12-15',
      periodEnd: '2025-01-15',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/change de version/i);
    expect(res.body.error).toMatch(/scindez votre saisie/i);
    // Les deux tronçons de validité doivent être cités explicitement,
    // pas juste "il y a un problème".
    expect(res.body.error).toContain('2024-01-01');
    expect(res.body.error).toContain('2024-12-31');
    expect(res.body.error).toContain('2025-01-01');
  });
});

describe('Scope 3 — ancienne méthode du ratio sectoriel global (isolée)', () => {
  it("n'est plus proposée : la readiness l'indique explicitement, sans valeur inventée", async () => {
    const res = await agent.get('/api/calculations/scope3/readiness');
    expect(res.status).toBe(200);
    expect(res.body.sector).toBe('metallurgie');
    expect(res.body.method).toBe('achats_par_categorie');
    expect(res.body.legacySectorRatio.available).toBe(false);
  });

  it("refuse l'estimation par ratio sectoriel (410) avec un message qui oriente vers les achats par catégorie", async () => {
    const res = await agent.post('/api/calculations/scope3/estimate').send({
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
      amountMad: 100000,
    });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/par catégorie/);
  });
});

describe('Isolation multi-tenant — calculs', () => {
  it("empêche l'entreprise B de voir les résultats de calcul de l'entreprise A", async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send({
      companyName: 'AutoParts Maroc SA',
      sector: 'automobile',
      email: 'b@autoparts.ma',
      password: 'mot-de-passe-solide-B1',
    });

    const summaryB = await agentB.get('/api/calculations/summary');
    expect(summaryB.body.scope1Tco2e).toBe(0);
    expect(summaryB.body.bySite).toHaveLength(0);
  });

  it('rejette /api/calculations/summary sans authentification', async () => {
    const res = await request(app).get('/api/calculations/summary');
    expect(res.status).toBe(401);
  });
});
