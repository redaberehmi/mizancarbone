import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';

afterAll(async () => {
  await closeDatabase();
});

// Invariant de non-chevauchement des versions de facteurs d'émission : deux
// lignes du même code ne doivent jamais être valides simultanément pour une
// même date, sous peine d'ambiguïté silencieuse sur le facteur appliqué
// (voir getFactorForPeriod, calculation.service.js). Testé sur TOUTE la
// table, pas seulement sur electricity_ma_location_based_kwh — protège
// contre une régression future sur n'importe quel facteur.
describe('Non-chevauchement des versions de emission_factors', () => {
  it('aucun code n\'a deux versions dont les plages [valid_from, valid_to] se recouvrent', async () => {
    const result = await pool.query(
      `SELECT code, valid_from, valid_to FROM emission_factors ORDER BY code, valid_from`,
    );

    const byCode = new Map();
    for (const row of result.rows) {
      if (!byCode.has(row.code)) byCode.set(row.code, []);
      byCode.get(row.code).push(row);
    }

    const overlaps = [];
    for (const [code, versions] of byCode.entries()) {
      for (let i = 0; i < versions.length; i += 1) {
        for (let j = i + 1; j < versions.length; j += 1) {
          const a = versions[i];
          const b = versions[j];
          const aEnd = a.valid_to ?? '9999-12-31';
          const bEnd = b.valid_to ?? '9999-12-31';
          const overlap = a.valid_from <= bEnd && b.valid_from <= aEnd;
          if (overlap) {
            overlaps.push({ code, a, b });
          }
        }
      }
    }

    expect(overlaps).toEqual([]);
  });

  it('electricity_ma_location_based_kwh : exactement deux versions, bornes exactes, aucun recouvrement', async () => {
    const result = await pool.query(
      `SELECT value_kgco2e, valid_from, valid_to, is_national FROM emission_factors
       WHERE code = 'electricity_ma_location_based_kwh' ORDER BY valid_from`,
    );

    expect(result.rows).toHaveLength(2);

    const [generic, fm6e] = result.rows;
    expect(Number(generic.value_kgco2e)).toBeCloseTo(0.644, 6);
    expect(generic.valid_from).toBe('2024-01-01');
    expect(generic.valid_to).toBe('2025-12-31');

    expect(Number(fm6e.value_kgco2e)).toBeCloseTo(0.6426, 6);
    expect(fm6e.valid_from).toBe('2026-01-01');
    expect(fm6e.valid_to).toBeNull();
    // is_national reste à false tant que le statut (brouillon/final) et les
    // droits de réutilisation du fichier source ne sont pas confirmés par
    // FM6E — décision explicite, pas un oubli (voir seed 007).
    expect(fm6e.is_national).toBe(false);
  });

  it('une période 2025 utilise la version générique 0,644 ; une période 2026 utilise la version FM6E 0,6426 — jamais les deux pour la même entrée', async () => {
    await resetDatabase();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      companyName: 'Verif Versioning SA',
      sector: 'metallurgie',
      email: 'verif@versioning.ma',
      password: 'mot-de-passe-solide-123',
    });
    const siteRes = await agent.post('/api/companies/me/sites').send({ name: 'Site Test', city: 'Casablanca' });
    const siteId = siteRes.body.site.id;

    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2025-06-01',
      periodEnd: '2025-06-30',
      factorCode: 'electricity_ma_location_based_kwh',
      quantity: 1000,
    });
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      factorCode: 'electricity_ma_location_based_kwh',
      quantity: 1000,
    });

    const summary = await agent.get('/api/calculations/summary');
    const period2025 = summary.body.byPeriod.find((p) => p.periodStart === '2025-06-01');
    const period2026 = summary.body.byPeriod.find((p) => p.periodStart === '2026-06-01');

    expect(period2025.totalTco2e).toBeCloseTo(0.644, 6);
    expect(period2026.totalTco2e).toBeCloseTo(0.6426, 6);
  });
});
