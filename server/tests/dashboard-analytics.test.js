import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';
import { getDashboardAnalytics, getTopContributors, getQualityMetrics, getDataCompleteness, getAlerts } from '../src/modules/reports/dashboard-analytics.service.js';

const company = {
  companyName: 'Metal Forge SA',
  sector: 'metallurgie',
  email: 'contact@metalforge.ma',
  password: 'mot-de-passe-solide-123',
};

let agent;
let companyId;

// Insère un facteur de test (jamais un facteur "de production" modifié —
// toujours une source 'Test...' distincte, nettoyée après chaque test).
async function insertFactor({ code, scope, category, isNational = false, value = 1, source = 'Test' }) {
  const res = await pool.query(
    `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from)
     VALUES ($1, $1, $2, $3, 'unite', $4, $5, $6, 'MA', '2000-01-01') RETURNING id`,
    [code, scope, category, value, source, isNational],
  );
  return res.rows[0].id;
}

async function insertEntryAndResult({ companyId: entryCompanyId = companyId, siteId = null, periodStart, periodEnd, factorCode, factorId, scope, tco2e, verificationStatus = 'non_verifie' }) {
  const entryRes = await pool.query(
    `INSERT INTO activity_entries (company_id, site_id, period_start, period_end, factor_code, quantity)
     VALUES ($1, $2, $3, $4, $5, 1) RETURNING id`,
    [entryCompanyId, siteId, periodStart, periodEnd, factorCode],
  );
  await pool.query(
    `INSERT INTO emission_results (activity_entry_id, emission_factor_id, scope, tco2e, verification_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [entryRes.rows[0].id, factorId, scope, tco2e, verificationStatus],
  );
}

beforeEach(async () => {
  await resetDatabase();
  agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send(company);
  companyId = res.body.company.id;
});

// Toujours en afterEach (jamais en fin de corps de test) : si une assertion
// échoue avant la ligne de nettoyage, un facteur "Test..." resterait en base
// et ferait échouer le test suivant sur la contrainte UNIQUE(code, valid_from)
// — emission_factors n'est pas tronquée par resetDatabase (table de référence).
afterEach(async () => {
  // Toutes les entreprises (pas seulement companyId) : le test d'isolation
  // crée une entreprise B avec ses propres entrées, qui doivent aussi être
  // nettoyées avant de pouvoir supprimer les facteurs de test référencés.
  await pool.query(`DELETE FROM activity_entries`);
  await pool.query(`DELETE FROM emission_factors WHERE source LIKE 'Test%'`);
});

afterAll(async () => {
  await closeDatabase();
});

describe('Profil entreprise — CA et fréquence de reporting (dashboard v2)', () => {
  it('accepte et renvoie annualRevenueMad et reportingFrequency', async () => {
    const res = await agent.put('/api/companies/me').send({
      annualRevenueMad: 5_000_000,
      reportingFrequency: 'mensuelle',
    });
    expect(res.status).toBe(200);
    expect(res.body.company.annualRevenueMad).toBe(5_000_000);
    expect(res.body.company.reportingFrequency).toBe('mensuelle');
  });

  it('rejette une fréquence de reporting invalide', async () => {
    const res = await agent.put('/api/companies/me').send({ reportingFrequency: 'hebdomadaire' });
    expect(res.status).toBe(400);
  });
});

describe('Variation vs année de référence et intensité carbone', () => {
  it("indique 'no_data' tant qu'aucune émission n'est calculée, même sans année de référence", async () => {
    const analytics = await getDashboardAnalytics(companyId);
    expect(analytics.yearlyComparison.available).toBe(false);
    expect(analytics.yearlyComparison.reason).toBe('no_data');
    expect(analytics.carbonIntensity).toBeNull();
  });

  it("indique 'base_year_not_set' si des données existent mais qu'aucune année de référence n'est définie", async () => {
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 50 });

    const analytics = await getDashboardAnalytics(companyId);
    expect(analytics.yearlyComparison.available).toBe(false);
    expect(analytics.yearlyComparison.reason).toBe('base_year_not_set');
    expect(analytics.carbonIntensity).toBeNull();
  });

  it("indique 'base_year_no_data' si l'année de référence n'a aucune donnée calculée", async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2023 });
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 50 });

    const analytics = await getDashboardAnalytics(companyId);
    expect(analytics.yearlyComparison.available).toBe(false);
    expect(analytics.yearlyComparison.reason).toBe('base_year_no_data');
  });

  it("indique 'insufficient_history' si seule l'année de référence a des données", async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2023 });
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ periodStart: '2023-01-01', periodEnd: '2023-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 50 });

    const analytics = await getDashboardAnalytics(companyId);
    expect(analytics.yearlyComparison.available).toBe(false);
    expect(analytics.yearlyComparison.reason).toBe('insufficient_history');
  });

  it("calcule la variation vs l'année de référence sur l'année civile la plus récente (jamais un cumul depuis toujours)", async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2023, annualRevenueMad: 5_000_000 });
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ periodStart: '2023-01-01', periodEnd: '2023-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 100 });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 50 });

    const analytics = await getDashboardAnalytics(companyId);
    expect(analytics.yearlyComparison.available).toBe(true);
    expect(analytics.yearlyComparison.mostRecentYear.year).toBe(2024);
    expect(analytics.yearlyComparison.baseYear.year).toBe(2023);
    expect(analytics.yearlyComparison.variationPct).toBeCloseTo(-50, 5);

    // Intensité carbone : total de l'année la plus récente (50 tCO2e) / CA en MDH (5)
    expect(analytics.carbonIntensity).toBeCloseTo(10, 5);
  });

  it("l'intensité carbone reste indisponible sans CA renseigné, même avec une comparaison disponible", async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2023 });
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ periodStart: '2023-01-01', periodEnd: '2023-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 100 });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 50 });

    const analytics = await getDashboardAnalytics(companyId);
    expect(analytics.yearlyComparison.available).toBe(true);
    expect(analytics.annualRevenueMad).toBeNull();
    expect(analytics.carbonIntensity).toBeNull();
  });
});

describe('Top contributeurs et alarme de concentration', () => {
  it('classe les postes par tCO2e décroissant avec le bon pourcentage du total', async () => {
    const dieselId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    const gasId = await insertFactor({ code: 'natural_gas_m3', scope: 1, category: 'combustion_fixe' });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId: dieselId, scope: 1, tco2e: 90 });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'natural_gas_m3', factorId: gasId, scope: 1, tco2e: 10 });

    const top = await getTopContributors(companyId, 5);
    expect(top[0].factorCode).toBe('diesel_L');
    expect(top[0].pctOfTotal).toBeCloseTo(90, 5);
    expect(top[1].pctOfTotal).toBeCloseTo(10, 5);
  });

  it('déclenche une alarme de concentration excessive (>70%) sur un seul poste', async () => {
    const dieselId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    const gasId = await insertFactor({ code: 'natural_gas_m3', scope: 1, category: 'combustion_fixe' });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId: dieselId, scope: 1, tco2e: 90 });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'natural_gas_m3', factorId: gasId, scope: 1, tco2e: 10 });

    const alerts = await getAlerts(companyId);
    expect(alerts.some((a) => a.code === 'concentration_excessive')).toBe(true);
  });

  it("ne déclenche aucune alarme de concentration si aucun poste ne dépasse 70%", async () => {
    const dieselId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    const gasId = await insertFactor({ code: 'natural_gas_m3', scope: 1, category: 'combustion_fixe' });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId: dieselId, scope: 1, tco2e: 55 });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'natural_gas_m3', factorId: gasId, scope: 1, tco2e: 45 });

    const alerts = await getAlerts(companyId);
    expect(alerts.some((a) => a.code === 'concentration_excessive')).toBe(false);
  });
});

describe('Qualité méthodologique', () => {
  it('pondère la part de facteurs nationaux par tCO2e, pas par nombre de lignes', async () => {
    const nationalId = await insertFactor({ code: 'facteur_national_test', scope: 1, category: 'combustion_fixe', isNational: true });
    const genericId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile', isNational: false });
    // 1 ligne nationale à 80 tCO2e, 1 ligne générique à 20 tCO2e -> 80% pondéré,
    // pas 50% (qui serait le résultat d'un comptage par nombre de lignes).
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'facteur_national_test', factorId: nationalId, scope: 1, tco2e: 80 });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId: genericId, scope: 1, tco2e: 20 });

    const quality = await getQualityMetrics(companyId);
    expect(quality.nationalSharePct).toBeCloseTo(80, 5);
  });

  it('répartit verification_status en % du total tCO2e', async () => {
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 70, verificationStatus: 'totalement_verifie' });
    await insertEntryAndResult({ periodStart: '2024-02-01', periodEnd: '2024-02-28', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 30, verificationStatus: 'non_verifie' });

    const quality = await getQualityMetrics(companyId);
    const totalement = quality.verificationBreakdown.find((v) => v.status === 'totalement_verifie');
    const nonVerifie = quality.verificationBreakdown.find((v) => v.status === 'non_verifie');
    expect(totalement.pctOfTotal).toBeCloseTo(70, 5);
    expect(nonVerifie.pctOfTotal).toBeCloseTo(30, 5);
  });

  it('déclenche une alarme de chute de la part de facteurs nationaux (>10 points vs période précédente)', async () => {
    const nationalId = await insertFactor({ code: 'facteur_national_test', scope: 1, category: 'combustion_fixe', isNational: true });
    const genericId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile', isNational: false });
    // Période 1 : 100% national. Période 2 : 0% national -> chute de 100 points.
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'facteur_national_test', factorId: nationalId, scope: 1, tco2e: 50 });
    await insertEntryAndResult({ periodStart: '2024-02-01', periodEnd: '2024-02-29', factorCode: 'diesel_L', factorId: genericId, scope: 1, tco2e: 50 });

    const alerts = await getAlerts(companyId);
    expect(alerts.some((a) => a.code === 'chute_part_nationale')).toBe(true);
  });
});

describe('Variation anormale par site (MoM)', () => {
  it('déclenche une alarme si un site augmente de plus de 20% entre deux périodes', async () => {
    const siteRes = await agent.post('/api/companies/me/sites').send({ name: 'Site Tanger' });
    const siteId = siteRes.body.site.id;
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 100 });
    await insertEntryAndResult({ siteId, periodStart: '2024-02-01', periodEnd: '2024-02-29', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 130 });

    const alerts = await getAlerts(companyId);
    expect(alerts.some((a) => a.code === 'variation_anormale_site')).toBe(true);
  });

  it("ne déclenche rien pour une variation inférieure au seuil", async () => {
    const siteRes = await agent.post('/api/companies/me/sites').send({ name: 'Site Tanger' });
    const siteId = siteRes.body.site.id;
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 100 });
    await insertEntryAndResult({ siteId, periodStart: '2024-02-01', periodEnd: '2024-02-29', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 105 });

    const alerts = await getAlerts(companyId);
    expect(alerts.some((a) => a.code === 'variation_anormale_site')).toBe(false);
  });
});

describe('Complétude des données et alarme "données manquantes"', () => {
  it("reste indisponible sans fréquence de reporting déclarée", async () => {
    const completeness = await getDataCompleteness(companyId, null);
    expect(completeness.available).toBe(false);
    expect(completeness.reason).toBe('reporting_frequency_not_set');
  });

  it('calcule la complétude sur les périodes mensuelles attendues (site × mois avec au moins une saisie)', async () => {
    const siteRes = await agent.post('/api/companies/me/sites').send({ name: 'Site Tanger' });
    const siteId = siteRes.body.site.id;
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    // Janvier et mars renseignés, février manquant -> 2 mois sur 3 attendus.
    await insertEntryAndResult({ siteId, periodStart: '2024-01-05', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 10 });
    await insertEntryAndResult({ siteId, periodStart: '2024-03-05', periodEnd: '2024-03-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 10 });

    const completeness = await getDataCompleteness(companyId, 'mensuelle');
    expect(completeness.available).toBe(true);
    expect(completeness.expectedPeriods).toBe(3);
    expect(completeness.siteCount).toBe(1);
    expect(completeness.completenessPct).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("déclenche une alarme de données manquantes pour un site sans saisie récente", async () => {
    await agent.put('/api/companies/me').send({ reportingFrequency: 'mensuelle' });
    const siteRes = await agent.post('/api/companies/me/sites').send({ name: 'Site Casablanca' });
    const siteId = siteRes.body.site.id;
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    // Dernière saisie très ancienne -> écart largement supérieur à 1 période mensuelle.
    await insertEntryAndResult({ siteId, periodStart: '2020-01-01', periodEnd: '2020-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 10 });

    const alerts = await getAlerts(companyId);
    expect(alerts.some((a) => a.code === 'donnees_manquantes')).toBe(true);
  });
});

describe('Alarme de garde-fou — recalcul de base_year sans raison', () => {
  it("se déclenche si une ligne base_year_recalculations existe sans raison exploitable (ne devrait jamais arriver via l'API)", async () => {
    await pool.query(
      `INSERT INTO base_year_recalculations (company_id, previous_base_year, new_base_year, reason)
       VALUES ($1, 2022, 2023, '')`,
      [companyId],
    );

    const alerts = await getAlerts(companyId);
    expect(alerts.some((a) => a.code === 'recalcul_sans_raison')).toBe(true);
  });

  it("ne se déclenche jamais pour un recalcul normal passé par l'API (raison toujours renseignée)", async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2023 });
    await agent.put('/api/companies/me').send({ baseYear: 2024, baseYearChangeReason: 'Cession du site de Tanger' });

    const alerts = await getAlerts(companyId);
    expect(alerts.some((a) => a.code === 'recalcul_sans_raison')).toBe(false);
  });
});

describe('Isolation multi-tenant — dashboard analytics', () => {
  it("renvoie une réponse vide et scopée pour l'entreprise B tant qu'elle n'a aucune donnée propre (cas trivial)", async () => {
    const factorId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId, scope: 1, tco2e: 999 });

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send({
      companyName: 'AutoParts Maroc SA',
      sector: 'automobile',
      email: 'b@autoparts.ma',
      password: 'mot-de-passe-solide-B1',
    });

    const res = await agentB.get('/api/reports/dashboard-analytics');
    expect(res.status).toBe(200);
    expect(res.body.topContributors).toHaveLength(0);
    expect(res.body.alerts).toHaveLength(0);
    expect(res.body.quality.nationalSharePct).toBeNull();
  });

  // Preuve forte (contrairement au test ci-dessus, où B n'a aucune donnée —
  // l'isolation y est triviale) : les deux entreprises ont des données
  // réelles et distinctes, vérifiées dans les DEUX sens. Même correction que
  // celle déjà appliquée à ce type de test aux Modules 4 et 6 (reports.test.js).
  it("les KPI, top contributeurs et alarmes de A et B restent distincts et jamais mélangés, chacune ayant ses propres données réelles", async () => {
    const dieselId = await insertFactor({ code: 'diesel_L', scope: 1, category: 'combustion_mobile' });
    await insertEntryAndResult({ periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', factorId: dieselId, scope: 1, tco2e: 90 });

    const agentB = request.agent(app);
    const regB = await agentB.post('/api/auth/register').send({
      companyName: 'AutoParts Maroc SA',
      sector: 'automobile',
      email: 'b@autoparts.ma',
      password: 'mot-de-passe-solide-B1',
    });
    const companyBId = regB.body.company.id;

    // Facteur national, poste et magnitude différents de ceux de A, pour que
    // toute contamination croisée (même partielle) soit détectable.
    const nationalId = await insertFactor({ code: 'facteur_national_b_test', scope: 1, category: 'combustion_fixe', isNational: true });
    await insertEntryAndResult({
      companyId: companyBId, periodStart: '2024-01-01', periodEnd: '2024-01-31',
      factorCode: 'facteur_national_b_test', factorId: nationalId, scope: 1, tco2e: 60,
    });

    const resA = await agent.get('/api/reports/dashboard-analytics');
    expect(resA.status).toBe(200);
    expect(resA.body.topContributors).toHaveLength(1);
    expect(resA.body.topContributors[0].factorCode).toBe('diesel_L');
    expect(resA.body.quality.nationalSharePct).toBe(0); // diesel_L n'est pas national

    const resB = await agentB.get('/api/reports/dashboard-analytics');
    expect(resB.status).toBe(200);
    expect(resB.body.topContributors).toHaveLength(1);
    expect(resB.body.topContributors[0].factorCode).toBe('facteur_national_b_test');
    expect(resB.body.quality.nationalSharePct).toBe(100);

    // Chaque entreprise ne concentre son alarme "concentration excessive" que
    // sur son propre poste — jamais sur celui de l'autre.
    expect(resA.body.alerts.some((a) => a.message.includes('facteur_national_b_test'))).toBe(false);
    expect(resB.body.alerts.some((a) => a.message.includes('diesel_L'))).toBe(false);
  });

  it('rejette /api/reports/dashboard-analytics sans authentification', async () => {
    const res = await request(app).get('/api/reports/dashboard-analytics');
    expect(res.status).toBe(401);
  });
});
