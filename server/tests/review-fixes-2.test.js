import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';

// Seconde relecture (2026-11-19) : un test par défaut, scénario reproduit.

let agent;
let siteA;

beforeEach(async () => {
  await resetDatabase();
  agent = request.agent(app);
  await agent.post('/api/auth/register').send({ companyName: 'Metal Forge SA', sector: 'metallurgie', email: 'a2@forge.ma', password: 'mot-de-passe-solide-123' });
  siteA = (await agent.post('/api/companies/me/sites').send({ name: 'Site A', city: 'Tanger' })).body.site.id;
});

afterAll(async () => {
  await pool.query("DELETE FROM activity_entries WHERE factor_code LIKE 'test_%'");
  await pool.query("DELETE FROM emission_factors WHERE code IN ('test_fuel_x_retire', 'test_fuel_x', 'test_diesel_corrige')");
  await closeDatabase();
});

async function setupBaseYearTwoLines(secondCode = 'diesel_L', secondSite = null) {
  await agent.put('/api/companies/me').send({ baseYear: 2024 });
  await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'diesel_L', quantity: 1000 });
  return agent.post('/api/activity-entries/energie').send({ siteId: secondSite ?? siteA, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: secondCode, quantity: 1000 });
}

async function validateRecalc(description) {
  const review = await agent.post('/api/methodology/base-year/reviews').send({ triggerType: 'changement_methodologique', description, estimatedImpactTco2e: 0 });
  return agent.patch(`/api/methodology/base-year/reviews/${review.body.review.id}`).send({ decision: 'recalcul_valide', note: 'Validation test' });
}

describe('1. Migration séparée, rejouable sur une base déjà migrée', () => {
  it('la migration 1738000012000 est idempotente et crée les champs attendus', async () => {
    const sql = readFileSync(path.resolve('src/db/migrations/1738000012000_methodology_review_fixes.sql'), 'utf8').split('-- Down Migration')[0];
    await pool.query(sql); // seconde exécution : aucune erreur
    const cols = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE (table_name = 'electricity_contracts' AND column_name IN ('qc_supplier_delivered_basis', 'qc_direct_claims_transferred'))
          OR (table_name = 'emission_factors' AND column_name = 'corrects_factor_id')
          OR (table_name = 'base_year_inventory_versions' AND column_name = 'excluded_site_ids')`,
    );
    expect(cols.rows).toHaveLength(4);
    expect((await agent.get('/api/reports/dashboard-analytics')).status).toBe(200);
  });
});

describe('2. Recalcul incomplet : validation bloquée', () => {
  it('une ligne devenue non calculable bloque la validation au lieu de faire baisser la référence (5,36 → 2,68)', async () => {
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, boundary, methodological_status)
       VALUES ('test_fuel_x', 'Combustible X (test)', 1, 'combustion_fixe', 'L', 2.68, 'Test méthodo X', false, 'MA', '2020-01-01', 'combustion', 'a_confirmer')
       ON CONFLICT (code, valid_from) DO NOTHING`,
    );
    const fx = await pool.query("SELECT id FROM emission_factors WHERE code = 'test_fuel_x'");
    try {
      await setupBaseYearTwoLines('test_fuel_x');
      expect((await agent.get('/api/methodology/base-year/recalculation-preview')).body.recalculated.totalScope12LocationBased).toBeCloseTo(5.36, 9);
      // Le facteur X est retiré par une correction : sa ligne n'est plus calculable.
      await pool.query(
        `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, boundary, methodological_status, corrects_factor_id)
         VALUES ('test_fuel_x_retire', 'Combustible X retiré (test)', 1, 'combustion_fixe', 'L', 2.68, 'Test méthodo X', false, 'MA', '2020-01-01', 'combustion', 'retire', $1)`,
        [fx.rows[0].id],
      );
      const preview = await agent.get('/api/methodology/base-year/recalculation-preview');
      expect(preview.body.recalculated.complete).toBe(false);
      expect(preview.body.recalculated.incompleteLines).toHaveLength(1);
      const decided = await validateRecalc('Retrait du facteur X');
      expect(decided.status).toBe(409);
      expect(decided.body.error).toMatch(/Recalcul incomplet/);
      const history = await agent.get('/api/methodology/base-year');
      expect(history.body.versions).toHaveLength(0);
      expect(history.body.reviews[0].decision).toBe('en_attente'); // rien n'a été enregistré
    } finally {
      await pool.query("DELETE FROM activity_entries WHERE factor_code = 'test_fuel_x'");
      await pool.query("DELETE FROM emission_factors WHERE code IN ('test_fuel_x_retire', 'test_fuel_x')");
    }
  });
});

describe('3. Recalcul : le périmètre enregistré est appliqué', () => {
  it('exclure le second site ramène la référence de 5,36 à 2,68 tCO2e', async () => {
    const siteB = (await agent.post('/api/companies/me/sites').send({ name: 'Site B', city: 'Kénitra' })).body.site.id;
    await setupBaseYearTwoLines('diesel_L', siteB);
    expect((await agent.get('/api/methodology/base-year/recalculation-preview')).body.recalculated.totalScope12LocationBased).toBeCloseTo(5.36, 9);
    await agent.post('/api/methodology/boundary/items').send({ itemType: 'site', name: 'Site B', siteId: siteB, included: false, justification: 'Cédé au 01/01/2025' });
    const decided = await validateRecalc('Cession du site B');
    expect(decided.status).toBe(200);
    expect(Number(decided.body.version.total_scope12_tco2e)).toBeCloseTo(2.68, 9);
    expect(decided.body.version.excluded_site_ids).toEqual([siteB]);
  });
});

describe('4. Avis externe : invalidé par un recalcul de la référence', () => {
  it("après un recalcul validé (2,68 → 2,51), l'avis n'est plus applicable", async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2024 });
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'diesel_L', quantity: 1000 });
    await agent.post('/api/methodology/assurance').send({ providerName: 'Organisme X', statementDate: '2025-03-01', scopeDescription: 'Scope 1 2024', assuranceLevel: 'limitee', documentReference: 'AVIS-2' });
    const original = await pool.query("SELECT id FROM emission_factors WHERE code = 'diesel_L' AND valid_from = '2024-01-01'");
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, boundary, methodological_status, corrects_factor_id)
       VALUES ('test_diesel_corrige', 'Gasoil corrigé (test)', 1, 'combustion_mobile', 'L', 2.51, 'Test méthodo correction', false, 'MA', '2024-01-01', 'combustion', 'a_confirmer', $1)`,
      [original.rows[0].id],
    );
    try {
      expect((await agent.get('/api/methodology/assurance')).body.statements[0].appliesToCurrentInventory).toBe(true);
      const decided = await validateRecalc('Facteur gasoil corrigé');
      expect(Number(decided.body.version.total_scope12_tco2e)).toBeCloseTo(2.51, 9);
      expect((await agent.get('/api/methodology/assurance')).body.statements[0].appliesToCurrentInventory).toBe(false);
    } finally {
      await pool.query("DELETE FROM emission_factors WHERE code = 'test_diesel_corrige'");
    }
  });
});

// ------------------------------------------------------------
// Troisième relecture (2026-11-19)
// ------------------------------------------------------------
describe('R3-1. Table des versions créée par une version intermédiaire', () => {
  it('la migration 1738000013000 rajoute excluded_site_ids si elle manque, et la validation fonctionne', async () => {
    await pool.query('ALTER TABLE base_year_inventory_versions DROP COLUMN IF EXISTS excluded_site_ids');
    await pool.query('ALTER TABLE base_year_inventory_versions DROP COLUMN IF EXISTS partial_exclusions');
    const sql = readFileSync(path.resolve('src/db/migrations/1738000013000_base_year_versions_excluded_sites.sql'), 'utf8').split('-- Down Migration')[0];
    await pool.query(sql);
    await pool.query(sql); // rejouable
    await setupBaseYearTwoLines();
    const decided = await validateRecalc('Contrôle après migration complémentaire');
    expect(decided.status).toBe(200);
    expect(decided.body.version.excluded_site_ids).toEqual([]);
  });
});

describe("R3-2. Exclure un actif loué n'exclut pas tout son site", () => {
  it('site inclus + actif loué exclu : la référence reste à 2,68 tCO2e et l’exclusion partielle est signalée', async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2024 });
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'diesel_L', quantity: 1000 });
    await agent.post('/api/methodology/boundary/items').send({ itemType: 'site', name: 'Site A', siteId: siteA, included: true, hasOperationalControl: true, justification: 'Exploité' });
    await agent.post('/api/methodology/boundary/items').send({ itemType: 'actif_loue', name: 'Chariot loué', siteId: siteA, included: false, justification: 'Loué, hors contrôle opérationnel' });
    const preview = await agent.get('/api/methodology/base-year/recalculation-preview');
    expect(preview.body.recalculated.totalScope12LocationBased).toBeCloseTo(2.68, 9);
    expect(preview.body.recalculated.excludedSiteIds).toEqual([]);
    expect(preview.body.recalculated.partialExclusions).toHaveLength(1);
    const decided = await validateRecalc('Sortie d’un actif loué');
    expect(decided.status).toBe(200);
    expect(Number(decided.body.version.total_scope12_tco2e)).toBeCloseTo(2.68, 9);
    expect(decided.body.version.partial_exclusions).toHaveLength(1);
  });

  it('un site déclaré à la fois inclus et exclu bloque la validation', async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2024 });
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'diesel_L', quantity: 1000 });
    await agent.post('/api/methodology/boundary/items').send({ itemType: 'site', name: 'Site A', siteId: siteA, included: true, hasOperationalControl: true, justification: 'Exploité' });
    await agent.post('/api/methodology/boundary/items').send({ itemType: 'site', name: 'Site A (doublon)', siteId: siteA, included: false, justification: 'Erreur de saisie' });
    const decided = await validateRecalc('Périmètre contradictoire');
    expect(decided.status).toBe(409);
    expect(decided.body.error).toMatch(/contradictoire/);
  });
});

describe('R3-3. Le contrôle porte sur ce qui est enregistré, dans la transaction', () => {
  it('sans contrôle préalable hors transaction, un recalcul incomplet est refusé et rien n’est enregistré', async () => {
    // Le contrôle préalable hors transaction a été supprimé : seul le
    // contrôle sur l'image figée de la transaction décide.
    const { readFileSync: rf } = await import('node:fs');
    const src = rf(path.resolve('src/modules/methodology/methodology.routes.js'), 'utf8');
    expect(src).toContain("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(src).not.toContain('const check = await computeBaseYearInventory');
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, boundary, methodological_status)
       VALUES ('test_fuel_x', 'Combustible X (test)', 1, 'combustion_fixe', 'L', 2.68, 'Test méthodo X', false, 'MA', '2020-01-01', 'combustion', 'a_confirmer')
       ON CONFLICT (code, valid_from) DO NOTHING`,
    );
    const fx = await pool.query("SELECT id FROM emission_factors WHERE code = 'test_fuel_x'");
    try {
      await setupBaseYearTwoLines('test_fuel_x');
      const review = await agent.post('/api/methodology/base-year/reviews').send({ triggerType: 'changement_methodologique', description: 'Changement concurrent simulé', estimatedImpactTco2e: 0 });
      // Modification intervenue APRÈS l'examen, avant la validation.
      await pool.query(
        `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, boundary, methodological_status, corrects_factor_id)
         VALUES ('test_fuel_x_retire', 'Combustible X retiré (test)', 1, 'combustion_fixe', 'L', 2.68, 'Test méthodo X', false, 'MA', '2020-01-01', 'combustion', 'retire', $1)`,
        [fx.rows[0].id],
      );
      const decided = await agent.patch(`/api/methodology/base-year/reviews/${review.body.review.id}`).send({ decision: 'recalcul_valide', note: 'Validation' });
      expect(decided.status).toBe(409);
      const versions = await pool.query('SELECT COUNT(*)::int AS n FROM base_year_inventory_versions');
      expect(versions.rows[0].n).toBe(0);
      const r = await pool.query('SELECT decision FROM base_year_recalculation_reviews WHERE id = $1', [review.body.review.id]);
      expect(r.rows[0].decision).toBe('en_attente');
    } finally {
      await pool.query("DELETE FROM activity_entries WHERE factor_code = 'test_fuel_x'");
      await pool.query("DELETE FROM emission_factors WHERE code IN ('test_fuel_x_retire', 'test_fuel_x')");
    }
  });
});
