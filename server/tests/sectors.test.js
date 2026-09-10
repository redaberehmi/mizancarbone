import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';
import { SECTORS } from '../src/modules/auth/auth.validation.js';

// Les 4 secteurs d'origine du brief + les 6 catégories officielles CBAM
// (fer_et_acier, aluminium, ciment, engrais, electricite, hydrogene) doivent
// tous respecter la même discipline méthodologique : mapping NAF explicite,
// placeholder Scope 3 structurellement inactif tant qu'aucune vraie valeur
// ADEME n'est fournie — jamais un traitement différent selon le secteur.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Secteurs — inscription acceptée pour les 10 secteurs cibles (4 d'origine + 6 CBAM)", () => {
  it.each(SECTORS)('accepte l\'inscription avec le secteur %s', async (sector) => {
    const res = await request(app).post('/api/auth/register').send({
      companyName: `Entreprise ${sector} SA`,
      sector,
      email: `${sector}@sectors-test.ma`,
      password: 'mot-de-passe-solide-123',
    });
    expect(res.status).toBe(201);
    expect(res.body.company.sector).toBe(sector);
  });

  it('rejette un secteur hors de la liste (jamais une valeur libre)', async () => {
    const res = await request(app).post('/api/auth/register').send({
      companyName: 'Entreprise Inconnue SA',
      sector: 'secteur_invente',
      email: 'inconnu@sectors-test.ma',
      password: 'mot-de-passe-solide-123',
    });
    expect(res.status).toBe(400);
  });
});

describe('Secteurs — chaque secteur a un mapping NAF explicite (sector_naf_mapping)', () => {
  it.each(SECTORS)("le secteur %s a exactement une ligne sector_naf_mapping", async (sector) => {
    const result = await pool.query(
      'SELECT naf_code_reference, naf_label FROM sector_naf_mapping WHERE sector = $1',
      [sector],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].naf_code_reference).toBeTruthy();
    expect(result.rows[0].naf_label).toBeTruthy();
  });
});

describe('Secteurs — chaque secteur a un placeholder Scope 3 structurellement inactif (jamais une valeur inventée)', () => {
  it.each(SECTORS)(
    "le placeholder scope3_ratio_%s existe, vaut 0 et est structurellement inactif (valid_to = valid_from)",
    async (sector) => {
      const result = await pool.query(
        `SELECT value_kgco2e, valid_from, valid_to FROM emission_factors WHERE code = $1`,
        [`scope3_ratio_${sector}`],
      );
      expect(result.rows).toHaveLength(1);
      expect(Number(result.rows[0].value_kgco2e)).toBe(0);
      expect(result.rows[0].valid_to).toEqual(result.rows[0].valid_from);
    },
  );

  it.each(SECTORS)(
    "l'estimation Scope 3 pour le secteur %s indique le ratio comme indisponible (readiness), aucune valeur inventée n'est utilisable",
    async (sector) => {
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send({
        companyName: `Entreprise ${sector} SA`,
        sector,
        email: `${sector}@sectors-readiness-test.ma`,
        password: 'mot-de-passe-solide-123',
      });
      const res = await agent.get('/api/calculations/scope3/readiness');
      expect(res.status).toBe(200);
      expect(res.body.sector).toBe(sector);
      expect(res.body.sectorRatioAvailable).toBe(false);
    },
  );
});
