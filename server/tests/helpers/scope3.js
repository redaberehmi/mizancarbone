import { pool } from '../../src/config/db.js';

// Facteur de TEST (jamais présent dans les seeds) : ratio monétaire en
// kgCO2e/kMAD, catégorie 1. 1 000 000 MAD = 1 000 kMAD × 20 = 20 000 kg = 20 t.
export const TEST_KMAD_FACTOR = 'test_scope3_kmad';

export async function ensureTestKmadFactor(value = 20) {
  await pool.query(
    `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from,
                                   boundary, methodological_status, rights_status, scope3_category, uncertainty_pct)
     VALUES ($1, 'Ratio monétaire de test', 3, 'scope3_achat_monetaire', 'kMAD', $2, 'Test kMAD', false, 'MA', '2020-01-01',
             'monetaire', 'a_confirmer', 'non_applicable', 1, 50)
     ON CONFLICT (code, valid_from) DO UPDATE SET value_kgco2e = EXCLUDED.value_kgco2e`,
    [TEST_KMAD_FACTOR, value],
  );
}

export async function addTestScope3Purchase(agent, { periodStart, periodEnd, amountMad, siteId = null }) {
  await ensureTestKmadFactor();
  return agent.post('/api/activity-entries/energie').send({
    siteId,
    periodStart,
    periodEnd,
    factorCode: TEST_KMAD_FACTOR,
    amountMad,
    factorJustification: 'Facteur de test pour une catégorie d’achat de services.',
  });
}

export async function removeTestScope3Purchases() {
  await pool.query('DELETE FROM activity_entries WHERE factor_code = $1', [TEST_KMAD_FACTOR]);
}
