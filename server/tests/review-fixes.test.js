import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';
import { ensureTestKmadFactor, TEST_KMAD_FACTOR } from './helpers/scope3.js';

// Un test par défaut signalé lors de la relecture du 2026-11-19, qui
// reproduit le scénario décrit. Valeurs attendues calculées à la main.

let agent;
let siteA;

beforeEach(async () => {
  await resetDatabase();
  agent = request.agent(app);
  await agent.post('/api/auth/register').send({ companyName: 'Metal Forge SA', sector: 'metallurgie', email: 'a@forge.ma', password: 'mot-de-passe-solide-123' });
  siteA = (await agent.post('/api/companies/me/sites').send({ name: 'Site A', city: 'Tanger' })).body.site.id;
});

afterAll(async () => {
  await pool.query("DELETE FROM activity_entries WHERE factor_code LIKE 'scope3_ratio_testlegacy' OR factor_code LIKE 'test_%'");
  await pool.query("DELETE FROM emission_factors WHERE code IN ('scope3_ratio_testlegacy', 'test_diesel_corrige')");
  await closeDatabase();
});

async function companyId() {
  return (await agent.get('/api/companies/me')).body.company.id;
}

function xlsxBuffer(req) {
  return req.buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('1. Scope 3 — l’ancienne estimation globale n’est plus additionnée', () => {
  it('100 t historiques + 10 t d’achats détaillés = 10 t de Scope 3 (pas 110 t)', async () => {
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, methodological_status)
       VALUES ('scope3_ratio_testlegacy', 'Ratio historique test', 3, 'scope3_ratio', 'k€', 1000, 'Test méthodo legacy', false, 'MA', '2020-01-01', 'retire')
       ON CONFLICT (code, valid_from) DO NOTHING`,
    );
    const factor = await pool.query("SELECT id FROM emission_factors WHERE code = 'scope3_ratio_testlegacy'");
    const id = await companyId();
    const entry = await pool.query(
      `INSERT INTO activity_entries (company_id, period_start, period_end, factor_code, quantity) VALUES ($1, '2024-01-01', '2024-12-31', 'scope3_ratio_testlegacy', 100) RETURNING id`,
      [id],
    );
    await pool.query('INSERT INTO emission_results (activity_entry_id, emission_factor_id, scope, tco2e) VALUES ($1, $2, 3, 100)', [entry.rows[0].id, factor.rows[0].id]);

    await ensureTestKmadFactor(20);
    // 500 000 MAD = 500 kMAD × 20 kgCO2e/kMAD = 10 000 kg = 10 t
    await agent.post('/api/activity-entries/energie').send({
      periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: TEST_KMAD_FACTOR, amountMad: 500000, factorJustification: 'Services de conseil.',
    });

    const s = await agent.get('/api/calculations/summary');
    expect(s.body.scope3Tco2e).toBeCloseTo(10, 9);
    expect(s.body.legacyScope3Ratio.tco2e).toBeCloseTo(100, 9);
    expect(s.body.bySite.reduce((t, b) => t + b.totalTco2e, 0)).toBeCloseTo(10, 9);

    const sim = await agent.post('/api/financing/carbon-cost/simulate').send({ pricePerTco2e: 1, currency: 'MAD', scopes: [3], year: 2024 });
    expect(sim.body.consideredTco2e).toBeCloseTo(10, 9);
  });
});

describe('2. CBAM — rattachements et exports', () => {
  it("refuse une donnée d'un autre site, ne calcule pas l'électricité, et reprend les procédés dans les trois exports", async () => {
    const siteB = (await agent.post('/api/companies/me/sites').send({ name: 'Site B', city: 'Kénitra' })).body.site.id;
    const dieselB = await agent.post('/api/activity-entries/energie').send({ siteId: siteB, periodStart: '2026-01-01', periodEnd: '2026-12-31', factorCode: 'diesel_L', quantity: 1000 });
    const dieselA = await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2026-01-01', periodEnd: '2026-12-31', factorCode: 'diesel_L', quantity: 1000 });
    const inst = await agent.post('/api/cbam/installations').send({ name: 'Laminoir A', siteId: siteA });
    const proc = await agent.post('/api/cbam/processes').send({
      installationId: inst.body.installation.id, name: 'Laminage à chaud', productName: 'Tôles', cnCode: '72081000',
      periodStart: '2026-01-01', periodEnd: '2026-12-31', productionTonnes: 100, attributionNote: 'Compteurs dédiés',
    });
    const pid = proc.body.process.id;
    const foreign = await agent.post(`/api/cbam/processes/${pid}/entries`).send({ activityEntryId: dieselB.body.entry.id, sharePct: 100 });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toMatch(/autre site/);
    const ok = await agent.post(`/api/cbam/processes/${pid}/entries`).send({ activityEntryId: dieselA.body.entry.id, sharePct: 100 });
    expect(ok.body.process.status).toBe('calcule_valeurs_reelles');

    const elec = await agent.post('/api/cbam/processes').send({
      installationId: inst.body.installation.id, name: 'Production électrique', productName: 'Électricité', cnCode: '27160000',
      periodStart: '2026-01-01', periodEnd: '2026-12-31', productionTonnes: 50, attributionNote: 'Turbine',
    });
    expect(elec.body.process.status).toBe('non_pris_en_charge');
    expect(elec.body.process.specificDirectEmissions).toBeNull();
    expect(elec.body.process.unsupported.join(' ')).toMatch(/2716/);

    // Installation sans site : aucun rattachement possible.
    const instNoSite = await agent.post('/api/cbam/installations').send({ name: 'Sans site' });
    const procNoSite = await agent.post('/api/cbam/processes').send({
      installationId: instNoSite.body.installation.id, name: 'Procédé X', productName: 'Barres', cnCode: '72142000',
      periodStart: '2026-01-01', periodEnd: '2026-12-31', productionTonnes: 10, attributionNote: 'x',
    });
    const noSite = await agent.post(`/api/cbam/processes/${procNoSite.body.process.id}/entries`).send({ activityEntryId: dieselA.body.entry.id, sharePct: 10 });
    expect(noSite.status).toBe(400);

    const csv = await agent.get('/api/cbam-prep/export.csv');
    expect(csv.text).toContain('Laminage à chaud');
    expect(csv.text).toContain('Non pris en charge');
    const { buildPreparationReportHtml } = await import('../src/modules/cbam-prep/cbam-prep.service.js');
    const html = await buildPreparationReportHtml(await companyId());
    expect(html).toContain('Procédés — émissions intrinsèques');
    expect(html).toContain('Laminage à chaud');
    const xlsx = await xlsxBuffer(agent.get('/api/cbam-prep/export.xlsx'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    const sheet = wb.getWorksheet('Procédés CBAM');
    expect(sheet).toBeTruthy();
    expect(sheet.rowCount).toBe(4); // en-tête + 3 procédés
  });
});

describe('3. Avis externe — un changement de périmètre l’invalide', () => {
  it("après exclusion d'un site, l'avis ne s'applique plus à l'inventaire actuel", async () => {
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100 });
    await agent.post('/api/methodology/assurance').send({
      providerName: 'Organisme X', statementDate: '2025-03-01', scopeDescription: 'Scope 1', assuranceLevel: 'limitee', documentReference: 'AVIS-1',
    });
    expect((await agent.get('/api/methodology/assurance')).body.statements[0].appliesToCurrentInventory).toBe(true);
    await agent.post('/api/methodology/boundary/items').send({ itemType: 'exclusion', name: 'Site A', siteId: siteA, included: false, justification: 'Cédé en 2025' });
    expect((await agent.get('/api/methodology/assurance')).body.statements[0].appliesToCurrentInventory).toBe(false);
  });
});

describe('4. Scope 2 — critères 6 (fournisseur) et 7 (achat direct)', () => {
  const base = {
    periodStart: '2026-01-01', periodEnd: '2026-12-31', volumeKwh: 10000, factorKgco2ePerKwh: 0.1, factorSource: 'Fournisseur',
    documentReference: 'DOC', qcConveysAttribute: true, qcUniqueClaim: true, qcRetiredOnBehalf: true, qcVintageCloseToPeriod: true, qcSameMarket: true,
  };
  beforeEach(async () => {
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2026-01-01', periodEnd: '2026-12-31', factorCode: 'electricity_ma_location_based_kwh', quantity: 100000 });
  });

  it('un taux fournisseur sans le critère 6 et un achat direct sans le critère 7 sont non admissibles', async () => {
    const supplier = await agent.post('/api/electricity/contracts').send({ siteId: siteA, instrumentType: 'taux_fournisseur', ...base });
    expect(supplier.body.contract.status).toBe('non_admissible');
    expect(supplier.body.contract.missing).toContain('critère 6');
    const direct = await agent.post('/api/electricity/contracts').send({ siteId: siteA, instrumentType: 'contrat_fourniture_direct', ...base });
    expect(direct.body.contract.status).toBe('non_admissible');
    expect(direct.body.contract.missing).toContain('critère 7');
  });

  it('les mêmes instruments deviennent admissibles avec leur critère propre ; un certificat ne requiert ni 6 ni 7', async () => {
    const supplier = await agent.post('/api/electricity/contracts').send({ siteId: siteA, instrumentType: 'taux_fournisseur', ...base, qcSupplierDeliveredBasis: true });
    expect(supplier.body.contract.status).toBe('admissible');
    const cert = await agent.post('/api/electricity/contracts').send({ siteId: siteA, instrumentType: 'certificat_attributs', ...base });
    expect(cert.body.contract.status).toBe('admissible');
  });
});

describe('5. Contrats hybrides — contrôle consommation par consommation', () => {
  it("accepte le complément de janvier quand un contrat annuel n'en couvre qu'une part", async () => {
    // Consommations : janvier 100 kWh, février 100 kWh.
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2026-01-01', periodEnd: '2026-01-31', factorCode: 'electricity_ma_location_based_kwh', quantity: 100 });
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2026-02-01', periodEnd: '2026-02-28', factorCode: 'electricity_ma_location_based_kwh', quantity: 100 });
    // Contrat annuel 100 kWh : 50 kWh alloués à janvier, 50 à février (prorata).
    const annual = await agent.post('/api/electricity/contracts').send({ siteId: siteA, instrumentType: 'certificat_attributs', periodStart: '2026-01-01', periodEnd: '2026-12-31', volumeKwh: 100 });
    expect(annual.status).toBe(201);
    // Complément de 50 kWh sur janvier : 50 + 50 = 100 kWh = consommation de janvier.
    const january = await agent.post('/api/electricity/contracts').send({ siteId: siteA, instrumentType: 'certificat_attributs', periodStart: '2026-01-01', periodEnd: '2026-01-31', volumeKwh: 50 });
    expect(january.status).toBe(201);
    // 10 kWh de plus sur janvier dépasseraient sa consommation.
    const extra = await agent.post('/api/electricity/contracts').send({ siteId: siteA, instrumentType: 'certificat_attributs', periodStart: '2026-01-01', periodEnd: '2026-01-31', volumeKwh: 10 });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toMatch(/2026-01-01 au 2026-01-31/);
  });
});

describe('6. Simulation — absence de données ≠ zéro', () => {
  it("sans aucune donnée : non calculable, aucun montant ; avec un scope manquant : partiel", async () => {
    const none = await agent.post('/api/financing/carbon-cost/simulate').send({ pricePerTco2e: 100, currency: 'MAD', scopes: [1, 2], year: 2024 });
    expect(none.body.status).toBe('non_calculable');
    expect(none.body.simulatedCost).toBeNull();
    expect(none.body.consideredTco2e).toBeNull();
    expect(none.body.emissionsByScope[1]).toBeNull();

    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'diesel_L', quantity: 1000 });
    const partial = await agent.post('/api/financing/carbon-cost/simulate').send({ pricePerTco2e: 100, currency: 'MAD', scopes: [1, 2], year: 2024 });
    expect(partial.body.status).toBe('partiel');
    expect(partial.body.missingScopes).toEqual([2]);
    expect(partial.body.simulatedCost).toBeCloseTo(268, 9); // 2,68 t × 100 MAD
  });
});

describe('7. Export Excel — total Scope 1 + 2 + 3 jamais « Réel »', () => {
  it('avec une seule catégorie Scope 3, le total est chiffré mais annoté partiel', async () => {
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'diesel_L', quantity: 1000 });
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'electricity_ma_location_based_kwh', quantity: 1000 });
    await ensureTestKmadFactor(20);
    await agent.post('/api/activity-entries/energie').send({ periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: TEST_KMAD_FACTOR, amountMad: 100000, factorJustification: 'Services de conseil.' });
    const res = await xlsxBuffer(agent.get('/api/reports/export.xlsx'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.getWorksheet('Synthèse par scope');
    let total = null;
    sheet.eachRow((row) => {
      if (row.getCell(1).value === 'Total Scope 1 + 2 + 3') total = { tco2e: row.getCell(2).value, status: row.getCell(3).value };
    });
    // 2,68 + 0,644 + 2 = 5,324 t
    expect(total.tco2e).toBeCloseTo(5.324, 9);
    expect(total.status).toMatch(/^Partiel — Scope 3 limité à 1 catégorie/);
  });
});

describe("8. Année de référence — recalcul réellement versionné", () => {
  it("un facteur correctif produit une version 2 recalculée, sans toucher aux résultats enregistrés", async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2024 });
    const entry = await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'diesel_L', quantity: 1000 });
    await agent.post('/api/activity-entries/energie').send({ siteId: siteA, periodStart: '2025-01-01', periodEnd: '2025-12-31', factorCode: 'diesel_L', quantity: 1000 });
    const original = await pool.query("SELECT id FROM emission_factors WHERE code = 'diesel_L' AND valid_from = '2024-01-01'");
    // Correction méthodologique : 2,51 kgCO2e/L au lieu de 2,68 pour la même période.
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, boundary, methodological_status, corrects_factor_id)
       VALUES ('test_diesel_corrige', 'Gasoil corrigé (test)', 1, 'combustion_mobile', 'L', 2.51, 'Test méthodo correction', false, 'MA', '2024-01-01', 'combustion', 'a_confirmer', $1)`,
      [original.rows[0].id],
    );
    try {
      const preview = await agent.get('/api/methodology/base-year/recalculation-preview');
      expect(preview.body.current.totalScope12LocationBased).toBeCloseTo(2.68, 9);
      expect(preview.body.recalculated.totalScope12LocationBased).toBeCloseTo(2.51, 9);

      const review = await agent.post('/api/methodology/base-year/reviews').send({
        triggerType: 'changement_methodologique', description: 'Facteur gasoil corrigé (combustion seule sourcée)', estimatedImpactTco2e: -0.17,
      });
      const decided = await agent.patch(`/api/methodology/base-year/reviews/${review.body.review.id}`).send({ decision: 'recalcul_valide', note: 'Validé par la direction' });
      expect(decided.status).toBe(200);
      expect(decided.body.version.version_number).toBe(2);
      expect(Number(decided.body.version.total_scope12_tco2e)).toBeCloseTo(2.51, 9);

      const history = await agent.get('/api/methodology/base-year');
      expect(history.body.versions.map((v) => [v.version_number, v.origin])).toEqual([[1, 'initiale'], [2, 'recalcul_valide']]);
      expect(Number(history.body.versions[0].total_scope12_tco2e)).toBeCloseTo(2.68, 9);

      // Les résultats enregistrés ne changent pas…
      const stored = await pool.query('SELECT tco2e FROM emission_results WHERE activity_entry_id = $1', [entry.body.entry.id]);
      expect(Number(stored.rows[0].tco2e)).toBeCloseTo(2.68, 9);
      // …mais la comparaison utilise la version recalculée : (2,68 − 2,51) / 2,51 = +6,7729 %
      const dash = await agent.get('/api/reports/dashboard-analytics');
      expect(dash.body.yearlyComparison.baseYear.totalTco2e).toBeCloseTo(2.51, 9);
      expect(dash.body.yearlyComparison.variationPct).toBeCloseTo(((2.68 - 2.51) / 2.51) * 100, 6);
    } finally {
      await pool.query('DELETE FROM emission_factors WHERE code = $1', ['test_diesel_corrige']);
    }
  });
});
