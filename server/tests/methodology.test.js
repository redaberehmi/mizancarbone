import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';
import { ensureTestKmadFactor, TEST_KMAD_FACTOR } from './helpers/scope3.js';
import { parseFm6eWorkbook } from '../src/db/import/fm6e-registry.js';
import { applyFm6eImport } from '../src/db/import/fm6e-import.js';

// Valeurs attendues calculées indépendamment, à la main, dans chaque test.

const companyA = { companyName: 'Metal Forge SA', sector: 'metallurgie', email: 'a@metalforge.ma', password: 'mot-de-passe-solide-123' };
const companyB = { companyName: 'AutoParts Maroc SA', sector: 'automobile', email: 'b@autoparts.ma', password: 'mot-de-passe-solide-B1' };

let agent;
let siteId;

beforeEach(async () => {
  await resetDatabase();
  agent = request.agent(app);
  await agent.post('/api/auth/register').send(companyA);
  const siteRes = await agent.post('/api/companies/me/sites').send({ name: 'Site Tanger', city: 'Tanger' });
  siteId = siteRes.body.site.id;
});

afterAll(async () => {
  await pool.query("DELETE FROM activity_entries WHERE factor_code LIKE 'test_%'");
  await pool.query("DELETE FROM emission_factors WHERE code LIKE 'test_%' OR source LIKE 'Test méthodo%'");
  await closeDatabase();
});

async function companyId(a = agent) {
  const r = await a.get('/api/companies/me');
  return r.body.company.id;
}

async function addTestFactor({ code, scope, category, unit, value, boundary, scope3Category = null, validFrom = '2020-01-01', validTo = null, status = 'a_confirmer' }) {
  await pool.query(
    `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, valid_to,
                                   boundary, methodological_status, rights_status, scope3_category)
     VALUES ($1, $1, $2, $3, $4, $5, 'Test méthodo', false, 'MA', $6, $7, $8, $9, 'non_applicable', $10)
     ON CONFLICT (code, valid_from) DO NOTHING`,
    [code, scope, category, unit, value, validFrom, validTo, boundary, status, scope3Category],
  );
}

// ------------------------------------------------------------
describe('Scope 1 — séparation combustion / amont', () => {
  it('refuse un facteur « combustion + amont » pour le Scope 1 et ne le propose pas à la saisie', async () => {
    await addTestFactor({ code: 'test_diesel_amont', scope: 1, category: 'combustion_mobile', unit: 'L', value: 3.056, boundary: 'combustion_amont' });
    const factors = await agent.get('/api/activity-entries/factors');
    expect(factors.body.factors.some((f) => f.code === 'test_diesel_amont')).toBe(false);

    const res = await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'test_diesel_amont', quantity: 100,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ne permet pas de calculer des émissions Scope 1/);
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM activity_entries WHERE factor_code = 'test_diesel_amont'");
    expect(count.rows[0].n).toBe(0);
  });

  it("le calcul batch n'utilise jamais un facteur combustion + amont, même pour une donnée existante", async () => {
    await addTestFactor({ code: 'test_fioul_amont', scope: 1, category: 'combustion_fixe', unit: 'L', value: 3.376, boundary: 'combustion_amont' });
    const id = await companyId();
    await pool.query(
      `INSERT INTO activity_entries (company_id, site_id, period_start, period_end, factor_code, quantity) VALUES ($1, $2, '2024-01-01', '2024-01-31', 'test_fioul_amont', 10)`,
      [id, siteId],
    );
    const run = await agent.post('/api/calculations/run');
    expect(run.body.calculated).toBe(0);
    expect(run.body.skippedUnusableFactor).toBe(1);
    const summary = await agent.get('/api/calculations/summary');
    expect(summary.body.scope1Status.status).toBe('non_calcule'); // saisi, jamais 0
  });

  it('calcule une émission de procédé en Scope 1 avec un facteur de périmètre « procédé »', async () => {
    // 120 t de clinker × 498,5 kgCO2e/t = 59 820 kg = 59,82 t
    await addTestFactor({ code: 'test_clinker', scope: 1, category: 'procede', unit: 'tonne ciment', value: 498.5, boundary: 'procede' });
    const res = await agent.post('/api/activity-entries/energie').send({
      siteId, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'test_clinker', quantity: 120,
    });
    expect(res.status).toBe(201);
    const summary = await agent.get('/api/calculations/summary');
    const procede = summary.body.scope1Breakdown.find((b) => b.category === 'procede');
    expect(procede.tco2e).toBeCloseTo(59.82, 9);
    const fugitive = summary.body.scope1Breakdown.find((b) => b.category === 'fugitive');
    expect(fugitive.status).toBe('manquant');
    expect(fugitive.tco2e).toBeNull();
  });
});

// ------------------------------------------------------------
describe('Scope 3 — achats par catégorie (MAD, kMAD, kg, t)', () => {
  it('ratio monétaire : émissions = MAD / 1000 × facteur, sans conversion de devise', async () => {
    await ensureTestKmadFactor(20);
    // 1 234 567 MAD = 1 234,567 kMAD × 20 kgCO2e/kMAD = 24 691,34 kg = 24,69134 t
    const res = await agent.post('/api/activity-entries/energie').send({
      periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: TEST_KMAD_FACTOR, amountMad: 1234567,
      factorJustification: 'Prestations de services tertiaires faiblement matériels (conseil).',
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.entry.quantity)).toBeCloseTo(1234.567, 6);
    expect(res.body.entry.scope3_category).toBe(1);
    const summary = await agent.get('/api/calculations/summary');
    expect(summary.body.scope3Tco2e).toBeCloseTo(24.69134, 9);
    const cat1 = summary.body.scope3Breakdown.find((c) => c.category === 1);
    expect(cat1.tco2e).toBeCloseTo(24.69134, 9);
    expect(summary.body.scope3Coverage.categoriesWithData).toBe(1);
    expect(summary.body.scope3Coverage.isPartial).toBe(true);
  });

  it('refuse un ratio monétaire sans justification du choix de facteur', async () => {
    await ensureTestKmadFactor(20);
    const res = await agent.post('/api/activity-entries/energie').send({
      periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: TEST_KMAD_FACTOR, amountMad: 50000,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/justifié/);
  });

  it('fret en tonne.km : quantité = masse × distance, catégorie 4 ou 9 obligatoire', async () => {
    await addTestFactor({ code: 'test_fret_tkm', scope: 3, category: 'scope3_fret', unit: 'tonne.km', value: 0.1, boundary: 'transport_amont_combustion' });
    const noCat = await agent.post('/api/activity-entries/energie').send({
      periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'test_fret_tkm', massTonnes: 12, distanceKm: 350,
    });
    expect(noCat.status).toBe(400);
    // 12 t × 350 km = 4 200 t.km × 0,1 kgCO2e/t.km = 420 kg = 0,42 t
    const res = await agent.post('/api/activity-entries/energie').send({
      periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'test_fret_tkm', massTonnes: 12, distanceKm: 350, scope3Category: 4,
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.entry.quantity)).toBe(4200);
    const summary = await agent.get('/api/calculations/summary');
    expect(summary.body.scope3Breakdown.find((c) => c.category === 4).tco2e).toBeCloseTo(0.42, 9);
  });

  it('une donnée Scope 3 non calculable reste « non calculé », jamais zéro', async () => {
    await addTestFactor({ code: 'test_dechets_v1', scope: 3, category: 'scope3_dechets', unit: 'tonne', value: 85.75, boundary: 'fin_de_vie', validFrom: '2020-01-01', validTo: '2020-12-31' });
    const id = await companyId();
    await pool.query(
      `INSERT INTO activity_entries (company_id, period_start, period_end, factor_code, quantity, scope3_category) VALUES ($1, '2024-01-01', '2024-12-31', 'test_dechets_v1', 5, 5)`,
      [id],
    );
    const summary = await agent.get('/api/calculations/summary');
    const cat5 = summary.body.scope3Breakdown.find((c) => c.category === 5);
    expect(cat5.status).toBe('non_calcule');
    expect(cat5.tco2e).toBeNull();
  });
});

// ------------------------------------------------------------
describe('Scope 2 — location-based, market-based et hybride', () => {
  async function addConsumption(kwh, periodStart = '2026-01-01', periodEnd = '2026-12-31') {
    return agent.post('/api/activity-entries/energie').send({
      siteId, periodStart, periodEnd, factorCode: 'electricity_ma_location_based_kwh', quantity: kwh,
    });
  }
  const admissible = {
    instrumentType: 'contrat_fourniture_direct', supplier: 'Parc éolien X', technology: 'éolien',
    periodStart: '2026-01-01', periodEnd: '2026-12-31', factorKgco2ePerKwh: 0.05, factorSource: 'Attestation du producteur',
    documentReference: 'CONTRAT-2026-01', qcConveysAttribute: true, qcUniqueClaim: true, qcRetiredOnBehalf: true,
    qcVintageCloseToPeriod: true, qcSameMarket: true, qcDirectClaimsTransferred: true,
  };

  it('consommation hybride sans double compte : contrat admissible + reste au facteur réseau', async () => {
    await addConsumption(100000); // LB = 100 000 × 0,6426 / 1000 = 64,26 t
    const c = await agent.post('/api/electricity/contracts').send({ siteId, volumeKwh: 40000, ...admissible });
    expect(c.status).toBe(201);
    expect(c.body.contract.status).toBe('admissible');
    // MB = 40 000 × 0,05 / 1000 + 60 000 × 0,6426 / 1000 = 2 + 38,556 = 40,556 t
    const s = await agent.get('/api/calculations/summary');
    expect(s.body.scope2LocationBasedTco2e).toBeCloseTo(64.26, 9);
    expect(s.body.scope2MarketBasedTco2e).toBeCloseTo(40.556, 9);
    expect(s.body.scope2MarketBased.consumptionKwh).toBe(100000); // consommation comptée une seule fois
    expect(s.body.scope2MarketBased.admissibleKwh).toBeCloseTo(40000, 6);
    // Les deux méthodes ne s'additionnent jamais dans les agrégats.
    const site = s.body.bySite.find((b) => b.siteId === siteId);
    expect(site.totalTco2e).toBeCloseTo(64.26, 9);
  });

  it('refuse une allocation qui dépasse la consommation, ou sans consommation saisie', async () => {
    const none = await agent.post('/api/electricity/contracts').send({ siteId, volumeKwh: 1000, ...admissible });
    expect(none.status).toBe(400);
    await addConsumption(100000);
    await agent.post('/api/electricity/contracts').send({ siteId, volumeKwh: 40000, ...admissible });
    const over = await agent.post('/api/electricity/contracts').send({ siteId, volumeKwh: 70000, ...admissible });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/dépasserait la consommation/);
  });

  it('un contrat renouvelable incomplet ou sans critères de qualité est non admissible : volume au facteur de repli', async () => {
    await addConsumption(100000);
    const res = await agent.post('/api/electricity/contracts').send({
      siteId, instrumentType: 'contrat_fournisseur', technology: 'solaire', periodStart: '2026-01-01', periodEnd: '2026-12-31',
      volumeKwh: 30000, factorKgco2ePerKwh: 0,
    });
    expect(res.status).toBe(201);
    expect(res.body.contract.status).toBe('non_admissible');
    expect(res.body.contract.missing).toContain('pièce justificative');
    const s = await agent.get('/api/calculations/summary');
    expect(s.body.scope2MarketBasedTco2e).toBeCloseTo(64.26, 9); // aucun facteur nul appliqué
  });

  it("l'autoconsommation et la vente sont enregistrées sans être déduites des émissions", async () => {
    await addConsumption(100000);
    await agent.post('/api/electricity/contracts').send({ siteId, instrumentType: 'autoconsommation', periodStart: '2026-01-01', periodEnd: '2026-12-31', volumeKwh: 5000 });
    await agent.post('/api/electricity/contracts').send({ siteId, instrumentType: 'vente_electricite', periodStart: '2026-01-01', periodEnd: '2026-12-31', volumeKwh: 2000 });
    const s = await agent.get('/api/calculations/summary');
    expect(s.body.scope2MarketBased.selfConsumptionKwh).toBe(5000);
    expect(s.body.scope2MarketBased.soldKwh).toBe(2000);
    expect(s.body.scope2LocationBasedTco2e).toBeCloseTo(64.26, 9);
    expect(s.body.scope2MarketBasedTco2e).toBeCloseTo(64.26, 9);
  });
});

// ------------------------------------------------------------
describe('Versionnement des facteurs et stabilité des résultats', () => {
  it("l'électricité 2025 reste à 0,644 et 2026 à 0,6426 ; une nouvelle version ne modifie pas les anciens résultats", async () => {
    await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2025-01-01', periodEnd: '2025-12-31', factorCode: 'electricity_ma_location_based_kwh', quantity: 1000 });
    await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2026-01-01', periodEnd: '2026-06-30', factorCode: 'electricity_ma_location_based_kwh', quantity: 1000 });
    const before = await agent.get('/api/calculations/summary');
    expect(before.body.scope2LocationBasedTco2e).toBeCloseTo(0.644 + 0.6426, 9);

    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from, boundary, methodological_status)
       VALUES ('electricity_ma_location_based_kwh', 'Électricité test future', 2, 'electricite_location_based', 'kWh', 0.5, 'Test méthodo future', false, 'MA', '2030-01-01', 'mix_production', 'a_confirmer')`,
    );
    try {
      await agent.post('/api/calculations/run');
      const after = await agent.get('/api/calculations/summary');
      expect(after.body.scope2LocationBasedTco2e).toBeCloseTo(0.644 + 0.6426, 9);
      const reg = await agent.get('/api/methodology/factors?category=electricite_location_based');
      const fm6e = reg.body.factors.find((f) => f.valid_from.startsWith('2026'));
      expect(fm6e.represented_year).toBe('2020'); // année du mix, distincte de l'utilisation (2026)
      expect(fm6e.boundary).toBe('mix_production');
    } finally {
      await pool.query("DELETE FROM emission_factors WHERE source = 'Test méthodo future'");
    }
  });
});

// ------------------------------------------------------------
describe("Année de référence — politique de recalcul", () => {
  beforeEach(async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2024 });
    // 1 000 L × 2,68 kgCO2e/L = 2,68 t (Scope 1 de l'année de référence)
    await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'diesel_L', quantity: 1000 });
  });

  it("sans seuil défini, aucune recommandation chiffrée n'est inventée", async () => {
    const res = await agent.post('/api/methodology/base-year/reviews/preview').send({
      triggerType: 'changement_structurel', description: 'Acquisition du site de Kénitra', estimatedImpactTco2e: 0.1,
    });
    expect(res.status).toBe(200);
    expect(res.body.recommendation).toBe('seuil_non_defini');
  });

  it("tient compte de l'effet cumulé et conserve l'historique des décisions", async () => {
    await agent.put('/api/methodology/base-year/policy').send({ thresholdPct: 5 });
    // 0,1 / 2,68 = 3,731 % < 5 %
    const r1 = await agent.post('/api/methodology/base-year/reviews').send({ triggerType: 'correction_erreur', description: 'Correction d’une facture de gasoil', estimatedImpactTco2e: 0.1 });
    expect(r1.status).toBe(201);
    expect(r1.body.review.recommendation).toBe('sous_le_seuil');
    expect(Number(r1.body.review.impact_pct)).toBeCloseTo((0.1 / 2.68) * 100, 3);
    // cumul : 0,2 / 2,68 = 7,463 % >= 5 %
    const r2 = await agent.post('/api/methodology/base-year/reviews').send({ triggerType: 'changement_methodologique', description: 'Nouveau facteur de combustion sourcé', estimatedImpactTco2e: 0.1 });
    expect(r2.body.review.recommendation).toBe('recalcul_recommande');
    expect(Number(r2.body.review.cumulative_impact_pct)).toBeCloseTo((0.2 / 2.68) * 100, 3);

    const decide = await agent.patch(`/api/methodology/base-year/reviews/${r2.body.review.id}`).send({ decision: 'recalcul_valide', note: 'Validé par la direction' });
    expect(decide.status).toBe(200);
    const again = await agent.patch(`/api/methodology/base-year/reviews/${r2.body.review.id}`).send({ decision: 'recalcul_non_retenu', note: 'Changement d’avis' });
    expect(again.status).toBe(404); // décision conservée, jamais réécrite
    const history = await agent.get('/api/methodology/base-year');
    expect(history.body.reviews).toHaveLength(2);
    expect(history.body.policyNote).toMatch(/ne fixe pas de seuil chiffré universel/);
  });
});

// ------------------------------------------------------------
describe('Contrôle interne et vérification externe', () => {
  it("un avis externe ne s'applique plus dès que l'inventaire change", async () => {
    const e = await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2024-01-01', periodEnd: '2024-01-31', factorCode: 'diesel_L', quantity: 100 });
    const rec = await agent.post('/api/methodology/assurance').send({
      providerName: 'Organisme indépendant X', statementDate: '2025-03-01', scopeDescription: 'Scopes 1 et 2, exercice 2024',
      assuranceLevel: 'limitee', documentReference: 'AVIS-2025-001',
    });
    expect(rec.status).toBe(201);
    let list = await agent.get('/api/methodology/assurance');
    expect(list.body.statements[0].appliesToCurrentInventory).toBe(true);

    await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2024-02-01', periodEnd: '2024-02-28', factorCode: 'diesel_L', quantity: 50 });
    list = await agent.get('/api/methodology/assurance');
    expect(list.body.statements[0].appliesToCurrentInventory).toBe(false);

    const noNote = await agent.patch(`/api/methodology/entries/${e.body.entry.id}/internal-control`).send({ status: 'anomalie_signalee' });
    expect(noNote.status).toBe(400);
    const ok = await agent.patch(`/api/methodology/entries/${e.body.entry.id}/internal-control`).send({ status: 'anomalie_signalee', note: 'Quantité à rapprocher de la facture' });
    expect(ok.status).toBe(200);
    const result = await pool.query('SELECT verification_status FROM emission_results WHERE activity_entry_id = $1', [e.body.entry.id]);
    expect(result.rows[0].verification_status).toBe('controle_interne_partiel');
  });
});

// ------------------------------------------------------------
describe('CBAM — émissions intrinsèques par procédé', () => {
  it('calcule un bien simple à partir des seules données rattachées (jamais le bilan global)', async () => {
    const diesel = await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2026-01-01', periodEnd: '2026-12-31', factorCode: 'diesel_L', quantity: 1000 });
    const elec = await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2026-01-01', periodEnd: '2026-12-31', factorCode: 'electricity_ma_location_based_kwh', quantity: 10000 });
    // Donnée NON rattachée : ne doit pas entrer dans le calcul.
    await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2026-01-01', periodEnd: '2026-12-31', factorCode: 'gasoline_L', quantity: 5000 });

    const inst = await agent.post('/api/cbam/installations').send({ name: 'Laminoir Tanger', siteId });
    const proc = await agent.post('/api/cbam/processes').send({
      installationId: inst.body.installation.id, name: 'Laminage à chaud', productName: 'Tôles', cnCode: '72081000',
      periodStart: '2026-01-01', periodEnd: '2026-12-31', productionTonnes: 100, attributionNote: 'Compteurs dédiés au laminoir',
    });
    const pid = proc.body.process.id;
    expect(proc.body.process.cnCheck.category).toBe('fer_et_acier');
    await agent.post(`/api/cbam/processes/${pid}/entries`).send({ activityEntryId: diesel.body.entry.id, sharePct: 100 });
    const linked = await agent.post(`/api/cbam/processes/${pid}/entries`).send({ activityEntryId: elec.body.entry.id, sharePct: 50 });
    const p = linked.body.process;
    // direct = 1 000 × 2,68 / 1000 = 2,68 t ; indirect = 10 000 × 0,6426 / 1000 × 50 % = 3,213 t
    expect(p.status).toBe('calcule_valeurs_reelles');
    expect(p.attributedDirectTco2e).toBeCloseTo(2.68, 9);
    expect(p.attributedIndirectTco2e).toBeCloseTo(3.213, 9);
    expect(p.specificDirectEmissions).toBeCloseTo(0.0268, 9);
    expect(p.specificIndirectEmissions).toBeCloseTo(0.03213, 9);
  });

  it("n'affiche aucun chiffre pour un bien complexe (précurseurs) et refuse les rattachements invalides", async () => {
    const diesel = await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2026-01-01', periodEnd: '2026-12-31', factorCode: 'diesel_L', quantity: 1000 });
    const inst = await agent.post('/api/cbam/installations').send({ name: 'Tréfilerie', siteId });
    const proc = await agent.post('/api/cbam/processes').send({
      installationId: inst.body.installation.id, name: 'Tréfilage', productName: 'Fil', cnCode: '72171000',
      periodStart: '2026-01-01', periodEnd: '2026-12-31', productionTonnes: 50, hasPrecursors: true, attributionNote: 'Ligne dédiée',
    });
    const pid = proc.body.process.id;
    const r = await agent.post(`/api/cbam/processes/${pid}/entries`).send({ activityEntryId: diesel.body.entry.id, sharePct: 80 });
    expect(r.body.process.status).toBe('non_pris_en_charge');
    expect(r.body.process.specificDirectEmissions).toBeNull();

    const proc2 = await agent.post('/api/cbam/processes').send({
      installationId: inst.body.installation.id, name: 'Autre', productName: 'Fil 2', cnCode: '72172000',
      periodStart: '2026-01-01', periodEnd: '2026-12-31', productionTonnes: 10, attributionNote: 'x',
    });
    const over = await agent.post(`/api/cbam/processes/${proc2.body.process.id}/entries`).send({ activityEntryId: diesel.body.entry.id, sharePct: 30 });
    expect(over.status).toBe(400); // 80 % + 30 % > 100 %

    await ensureTestKmadFactor(20);
    const s3 = await agent.post('/api/activity-entries/energie').send({ periodStart: '2026-01-01', periodEnd: '2026-12-31', factorCode: TEST_KMAD_FACTOR, amountMad: 1000, factorJustification: 'Test de rattachement refusé.' });
    const bad = await agent.post(`/api/cbam/processes/${pid}/entries`).send({ activityEntryId: s3.body.entry.id, sharePct: 10 });
    expect(bad.status).toBe(400);
  });

  it("indique l'appartenance à la liste de l'annexe I par code NC, jamais par le secteur", async () => {
    expect((await agent.get('/api/cbam/cn-check?code=2523')).body.status).toBe('a_preciser');
    expect((await agent.get('/api/cbam/cn-check?code=25232900')).body.category).toBe('ciment');
    expect((await agent.get('/api/cbam/cn-check?code=85011000')).body.status).toBe('hors_liste_annexe_I');
    expect((await agent.get('/api/cbam/cn-check?code=72042100')).body.status).toBe('hors_liste_annexe_I'); // 7204 exclu
  });
});

// ------------------------------------------------------------
describe('Simulation de coût carbone', () => {
  it('restitue les hypothèses et ne présente jamais un montant de taxe', async () => {
    await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2024-01-01', periodEnd: '2024-12-31', factorCode: 'diesel_L', quantity: 1000 });
    // 2,68 t × 100 MAD/t = 268 MAD
    const res = await agent.post('/api/financing/carbon-cost/simulate').send({ pricePerTco2e: 100, currency: 'MAD', scopes: [1], year: 2024 });
    expect(res.status).toBe(200);
    expect(res.body.simulatedCost).toBeCloseTo(268, 9);
    expect(res.body.assumptions).toMatchObject({ pricePerTco2e: 100, currency: 'MAD', scopes: [1], year: 2024 });
    expect(res.body.disclaimer).toMatch(/ni un montant de taxe dû/);
    expect(res.body.regulatoryStatus.status).toBe('non_confirme');
    const other = await agent.post('/api/financing/carbon-cost/simulate').send({ pricePerTco2e: 100, currency: 'MAD', scopes: [1], year: 2025 });
    // Aucune donnée en 2025 : non calculable, jamais 0 MAD.
    expect(other.body.simulatedCost).toBeNull();
    expect(other.body.status).toBe('non_calculable');
  });
});

// ------------------------------------------------------------
describe('Couverture du bilan', () => {
  it('une source non pertinente doit être justifiée ; une source pertinente sans donnée reste manquante', async () => {
    const bad = await agent.put('/api/methodology/coverage/relevance').send({ sourceCode: 'S1_fugitives', status: 'non_pertinente' });
    expect(bad.status).toBe(400);
    const ok = await agent.put('/api/methodology/coverage/relevance').send({ sourceCode: 'S1_procedes', status: 'pertinente' });
    expect(ok.status).toBe(200);
    expect(ok.body.summary.relevantMissing.some((l) => /procédés/.test(l))).toBe(true);
    const procedes = ok.body.sources.find((s) => s.code === 'S1_procedes');
    expect(procedes.dataState).toBe('manquant');
    expect(procedes.tco2e).toBeNull();
  });
});

// ------------------------------------------------------------
describe('Import FM6E — classement, reproductibilité, rejets', () => {
  function sheet(cells) {
    const ws = {};
    for (const [addr, v, f] of cells) ws[addr] = { v, ...(f ? { f } : {}) };
    return ws;
  }
  const workbook = {
    SheetNames: ['P1-S1-Source Fixe combustion', 'P2-S1-Source mobile Combust.', 'P6-S2-ConsommationElectricité', 'P10-S3.Immobilisations de biens'],
    Sheets: {
      'P1-S1-Source Fixe combustion': sheet([
        ['B41', 'Fioul lourd, amont et combustion'], ['C41', 3.376], ['D41', 'kgCO2e/litre'], ['E41', 0.1], ['M41', 'Base carbone combustion et FM6 amont'],
        ['B42', 'Pétrole brut, combustion'], ['C42', 3070], ['D42', 'kgCO2e/tonne'], ['E42', 0.05], ['M42', 'Base Carbone'],
        ['B43', 'Huile usée'], ['C43', 2.6244], ['D43', 'kgCO2e/litre'], ['E43', 0.1], ['M43', 'FM6E'],
      ]),
      'P2-S1-Source mobile Combust.': sheet([
        ['B38', 'Diesel Pompe'], ['C38', 3.056], ['D38', 'kgCO2e/Litre'], ['E38', 0.1], ['M38', 'Base carbone combustion et FM6 amont'],
      ]),
      'P6-S2-ConsommationElectricité': sheet([
        ['B49', 'Electricité réseau national - Mix moyen 2020'], ['C49', 0.721 / 1.122, '0.721/(1.122)'], ['D49', 'kgCO2e/kWh'], ['L49', 0.1], ['M49', 'FM6E'],
        ['B50', 'Taux de perte en ligne'], ['C50', 12.2], ['D50', '%'], ['L50', 0.2], ['M50', 'FM6E'],
        ['B56', 'Centrale éolienne'], ['C56', 0.0127, '12.7/1000'], ['D56', 'kgCO2e/kWh'], ['L56', 0.05], ['M56', 'Réseau durable 2016'],
      ]),
      'P10-S3.Immobilisations de biens': sheet([
        ['B44', 'Imprimante Laser'], ['C44', '197'], ['D44', 'kgCO2e/appareil'], ['E44', 0.5], ['F44', 'Base Carbone'],
        ['B45', 'Imprimante Laser'], ['C45', 197], ['D45', 'kgCO2e/appareil'], ['E45', 0.5], ['F45', 'Base Carbone'],
      ]),
    },
  };

  it('écarte les facteurs combustion + amont et de périmètre inconnu, dérive les pertes réseau, rejette les doublons', () => {
    const parsed = parseFm6eWorkbook(workbook);
    const codes = parsed.accepted.map((a) => a.activityLabel);
    expect(codes).toContain('Pétrole brut, combustion');
    expect(codes).not.toContain('Fioul lourd, amont et combustion');
    expect(codes).not.toContain('Diesel Pompe');
    expect(codes).not.toContain('Huile usée');
    expect(parsed.rejected.find((r) => r.label === 'Centrale éolienne').reason).toMatch(/cycle de vie/);
    // Pertes : 12,2 % × 0,721 / 1,122 = 0,0783975… kgCO2e/kWh
    const losses = parsed.accepted.find((a) => a.category === 'scope3_pertes_reseau');
    expect(losses.value).toBeCloseTo((0.122 * 0.721) / 1.122, 6);
    expect(losses.scope3Category).toBe(3);
    // Nombre saisi comme texte accepté avec anomalie ; doublon exact rejeté.
    const printer = parsed.accepted.filter((a) => a.activityLabel === 'Imprimante Laser');
    expect(printer).toHaveLength(1);
    expect(printer[0].value).toBe(197);
    expect(printer[0].usageRestrictions).toMatch(/saisie comme texte/);
    expect(parsed.rejected.some((r) => r.label === 'Imprimante Laser' && /Doublon/.test(r.reason))).toBe(true);
  });

  it("est reproductible : un second import ne crée aucun doublon et n'écrase jamais une valeur existante", async () => {
    const parsed = parseFm6eWorkbook(workbook);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const first = await applyFm6eImport(client, parsed, { fileSha256: 'a'.repeat(64), mode: 'applique', integrationDate: '2026-11-18' });
      expect(first.report.accepted.length).toBe(parsed.accepted.length);
      const second = await applyFm6eImport(client, parsed, { fileSha256: 'a'.repeat(64), mode: 'applique', integrationDate: '2026-11-18' });
      expect(second.report.accepted).toHaveLength(0);
      expect(second.report.unchanged.length).toBe(parsed.accepted.length);

      const altered = { ...parsed, accepted: parsed.accepted.map((a) => (a.activityLabel === 'Pétrole brut, combustion' ? { ...a, value: 9999 } : a)) };
      const third = await applyFm6eImport(client, altered, { fileSha256: 'b'.repeat(64), mode: 'apercu', integrationDate: '2026-11-18' });
      expect(third.report.rejected.some((r) => /n'est pas écrasé/.test(r.reason))).toBe(true);
      const stored = await client.query("SELECT value_kgco2e, rights_status, source_sheet FROM emission_factors WHERE factor_uid LIKE 'FM6E-BEGES/%P1-S1-Source Fixe combustion!C42'");
      expect(Number(stored.rows[0].value_kgco2e)).toBe(3070);
      expect(stored.rows[0].rights_status).toBe('a_confirmer');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

// ------------------------------------------------------------
describe('Isolation multi-tenant — nouveaux modules', () => {
  it("l'entreprise B ne voit ni ne modifie les contrats, procédés, avis, revues et périmètre de A", async () => {
    const elec = await agent.post('/api/activity-entries/energie').send({ siteId, periodStart: '2026-01-01', periodEnd: '2026-12-31', factorCode: 'electricity_ma_location_based_kwh', quantity: 1000 });
    const contract = await agent.post('/api/electricity/contracts').send({ siteId, instrumentType: 'autoconsommation', periodStart: '2026-01-01', periodEnd: '2026-12-31', volumeKwh: 100 });
    const inst = await agent.post('/api/cbam/installations').send({ name: 'Installation A' });
    await agent.post('/api/methodology/assurance').send({ providerName: 'Org', statementDate: '2025-01-01', scopeDescription: 'Scope 1', assuranceLevel: 'limitee', documentReference: 'DOC' });
    await agent.post('/api/methodology/boundary/items').send({ itemType: 'site', name: 'Site A', included: true, hasOperationalControl: true, justification: 'Exploité par A' });

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send(companyB);
    expect((await agentB.get('/api/electricity/market-based')).body.contracts).toHaveLength(0);
    expect((await agentB.get('/api/cbam/installations')).body.installations).toHaveLength(0);
    expect((await agentB.get('/api/methodology/assurance')).body.statements).toHaveLength(0);
    expect((await agentB.get('/api/methodology/boundary')).body.items).toHaveLength(0);
    expect((await agentB.delete(`/api/electricity/contracts/${contract.body.contract.id}`)).status).toBe(404);
    expect((await agentB.delete(`/api/cbam/installations/${inst.body.installation.id}`)).status).toBe(404);
    expect((await agentB.patch(`/api/methodology/entries/${elec.body.entry.id}/internal-control`).send({ status: 'controle_interne_effectue' })).status).toBe(404);

    const instB = await agentB.post('/api/cbam/installations').send({ name: 'Installation B' });
    const procB = await agentB.post('/api/cbam/processes').send({
      installationId: instB.body.installation.id, name: 'Procédé B', productName: 'Produit X', cnCode: '76011000', periodStart: '2026-01-01', periodEnd: '2026-12-31',
    });
    const steal = await agentB.post(`/api/cbam/processes/${procB.body.process.id}/entries`).send({ activityEntryId: elec.body.entry.id, sharePct: 10 });
    expect(steal.status).toBe(404);
    const crossInst = await agentB.post('/api/cbam/processes').send({
      installationId: inst.body.installation.id, name: 'Procédé B', productName: 'Produit X', cnCode: '76011000', periodStart: '2026-01-01', periodEnd: '2026-12-31',
    });
    expect(crossInst.status).toBe(400);
  });
});
