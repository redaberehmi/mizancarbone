import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';

function formatTco2e(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

export function CalculationResults() {
  const [summary, setSummary] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);

  const [form, setForm] = useState({ periodStart: '', periodEnd: '', amountMad: '' });
  const [estimateError, setEstimateError] = useState(null);
  const [estimateResult, setEstimateResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [summaryRes, readinessRes, estimatesRes] = await Promise.all([
      api.get('/calculations/summary'),
      api.get('/calculations/scope3/readiness'),
      api.get('/calculations/scope3'),
    ]);
    setSummary(summaryRes);
    setReadiness(readinessRes);
    setEstimates(estimatesRes.estimates);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const handleRun = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.post('/calculations/run', {});
      setRunResult(res);
      await loadAll();
    } finally {
      setRunning(false);
    }
  };

  const handleEstimateSubmit = async (e) => {
    e.preventDefault();
    setEstimateError(null);
    setEstimateResult(null);
    setSubmitting(true);
    try {
      const res = await api.post('/calculations/scope3/estimate', {
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        amountMad: Number(form.amountMad),
      });
      setEstimateResult(res.result);
      setForm({ periodStart: '', periodEnd: '', amountMad: '' });
      await loadAll();
    } catch (err) {
      setEstimateError(err instanceof ApiError ? err.message : "Erreur lors de l'estimation.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-mizan-ardoise">Calcul des émissions</h1>
          <p className="text-mizan-gris text-sm mt-1">
            Périmètre organisationnel : contrôle opérationnel. Structuré selon le GHG Protocol.
          </p>
        </div>
        <button onClick={handleRun} disabled={running} className="btn-secondary">
          {running ? 'Calcul…' : 'Recalculer Scope 1 & 2'}
        </button>
      </div>

      {runResult && (
        <p className="text-sm text-mizan-vert">
          {runResult.calculated} entrée(s) nouvellement calculée(s).
          {runResult.skippedNoFactor > 0 &&
            ` ${runResult.skippedNoFactor} entrée(s) sans facteur d'émission courant disponible (ignorée(s)).`}
        </p>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card">
          <p className="label-field">Scope 1</p>
          <p className="font-data text-2xl text-mizan-ardoise">{formatTco2e(summary.scope1Tco2e)}</p>
          <p className="text-xs text-mizan-gris">tCO2e</p>
        </div>
        <div className="card">
          <p className="label-field">Scope 2 — location-based</p>
          <p className="font-data text-2xl text-mizan-ardoise">{formatTco2e(summary.scope2LocationBasedTco2e)}</p>
          <p className="text-xs text-mizan-gris">tCO2e</p>
        </div>
        <div className="card">
          <p className="label-field">Scope 2 — market-based</p>
          <p className="font-data text-2xl text-mizan-ardoise">{formatTco2e(summary.scope2MarketBasedTco2e)}</p>
          <p className="text-xs text-mizan-gris">
            tCO2e{summary.scope2MarketBasedIsDefaulted && ' — identique au location-based (aucun contrat d\'énergie spécifique renseigné)'}
          </p>
        </div>
      </div>

      <div className="card border-mizan-alerte/30">
        <p className="label-field">Scope 3 — estimation (approche spend-based)</p>
        <p className="font-data text-2xl text-mizan-ardoise">{formatTco2e(summary.scope3Tco2e)} <span className="text-base">tCO2e</span></p>
        {summary.scope3Uncertainty && (
          <p className="text-sm text-mizan-alerte mt-1">
            Incertitude estimée : {summary.scope3Uncertainty.minPercent}–{summary.scope3Uncertainty.maxPercent}%.{' '}
            {summary.scope3Uncertainty.note}
          </p>
        )}
        {summary.scope3Tco2e === 0 && (
          <p className="text-sm text-mizan-gris mt-1">
            Aucune estimation Scope 3 enregistrée. C'est une estimation, jamais présentée avec le même niveau de
            confiance que le Scope 1/2.
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="font-display font-bold text-mizan-ardoise mb-4">Répartition par site</h2>
        {summary.bySite.length === 0 ? (
          <p className="text-sm text-mizan-gris">Aucun résultat calculé pour le moment.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-mizan-gris border-b border-mizan-menthe/60">
                <th className="py-2 pr-3">Site</th>
                <th className="py-2">Total (tCO2e)</th>
              </tr>
            </thead>
            <tbody>
              {summary.bySite.map((s) => (
                <tr key={s.siteId ?? 'sans-site'} className="border-b border-mizan-menthe/30">
                  <td className="py-2 pr-3">{s.siteName ?? 'Sans site (estimation Scope 3)'}</td>
                  <td className="py-2 font-data">{formatTco2e(s.totalTco2e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="font-display font-bold text-mizan-ardoise mb-4">Répartition par période</h2>
        {summary.byPeriod.length === 0 ? (
          <p className="text-sm text-mizan-gris">Aucun résultat calculé pour le moment.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-mizan-gris border-b border-mizan-menthe/60">
                <th className="py-2 pr-3">Période</th>
                <th className="py-2">Total (tCO2e)</th>
              </tr>
            </thead>
            <tbody>
              {summary.byPeriod.map((p) => (
                <tr key={`${p.periodStart}_${p.periodEnd}`} className="border-b border-mizan-menthe/30">
                  <td className="py-2 pr-3 font-data">{p.periodStart} → {p.periodEnd}</td>
                  <td className="py-2 font-data">{formatTco2e(p.totalTco2e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="font-display font-bold text-mizan-ardoise mb-1">Répartition par produit</h2>
        <p className="text-sm text-mizan-gris mb-4">
          Alimentée par la répartition produit du Module 4 (préparation CBAM) — tant qu'aucune allocation
          n'est renseignée, tout retombe dans « Non alloué ».
        </p>
        {summary.byProduct.length === 0 ? (
          <p className="text-sm text-mizan-gris">Aucun résultat calculé pour le moment.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-mizan-gris border-b border-mizan-menthe/60">
                <th className="py-2 pr-3">Produit</th>
                <th className="py-2">Total (tCO2e)</th>
              </tr>
            </thead>
            <tbody>
              {summary.byProduct.map((p) => (
                <tr key={p.productAllocation ?? 'non-alloue'} className="border-b border-mizan-menthe/30">
                  <td className="py-2 pr-3">{p.productAllocation ?? 'Non alloué'}</td>
                  <td className="py-2 font-data">{formatTco2e(p.totalTco2e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="font-display font-bold text-mizan-ardoise mb-1">Estimation Scope 3 — secteur {readiness.sector}</h2>
        <p className="text-sm text-mizan-gris mb-4">
          Chiffre d'affaires ou valeur des achats × ratio sectoriel (ADEME Base Empreinte, kgCO2e/k€) —
          approche spend-based du GHG Protocol. Estimation globale, pas un calcul ligne par ligne.
        </p>

        {readiness.nafMapping && (
          <p className="text-xs text-mizan-gris mb-4 font-data">
            Code NAF de référence : {readiness.nafMapping.naf_code_reference} — {readiness.nafMapping.naf_label}
          </p>
        )}

        {(!readiness.sectorRatioAvailable || !readiness.exchangeRateAvailable) && (
          <div className="rounded-lg border border-mizan-alerte/30 bg-mizan-alerte/5 p-3 mb-4">
            <p className="text-sm text-mizan-alerte font-medium">Estimation indisponible pour le moment :</p>
            <ul className="text-sm text-mizan-alerte list-disc list-inside">
              {!readiness.sectorRatioAvailable && (
                <li>Ratio monétaire ADEME Base Empreinte non encore renseigné pour ce secteur.</li>
              )}
              {!readiness.exchangeRateAvailable && <li>Taux de change EUR/MAD non configuré.</li>}
            </ul>
          </div>
        )}

        <form onSubmit={handleEstimateSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-field">Début de période</label>
              <input
                type="date"
                required
                disabled={!readiness.sectorRatioAvailable || !readiness.exchangeRateAvailable}
                className="input-field font-data"
                value={form.periodStart}
                onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Fin de période</label>
              <input
                type="date"
                required
                disabled={!readiness.sectorRatioAvailable || !readiness.exchangeRateAvailable}
                className="input-field font-data"
                value={form.periodEnd}
                onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label-field">Chiffre d'affaires ou valeur des achats (MAD)</label>
            <input
              type="number"
              step="any"
              min="0"
              required
              disabled={!readiness.sectorRatioAvailable || !readiness.exchangeRateAvailable}
              className="input-field font-data"
              value={form.amountMad}
              onChange={(e) => setForm({ ...form, amountMad: e.target.value })}
            />
          </div>
          {estimateError && <p className="text-sm text-mizan-alerte">{estimateError}</p>}
          <button
            type="submit"
            disabled={submitting || !readiness.sectorRatioAvailable || !readiness.exchangeRateAvailable}
            className="btn-primary"
          >
            {submitting ? 'Calcul…' : 'Estimer'}
          </button>
        </form>

        {estimateResult && (
          <div className="mt-4 rounded-lg border border-mizan-menthe bg-mizan-menthe/20 p-3">
            <p className="font-data text-lg text-mizan-ardoise">{formatTco2e(estimateResult.tco2e)} tCO2e</p>
            <p className="text-sm text-mizan-alerte">
              Incertitude estimée : {estimateResult.uncertainty.minPercent}–{estimateResult.uncertainty.maxPercent}%.
            </p>
            <p className="text-xs text-mizan-gris mt-1 font-data">
              {estimateResult.amountMad.toLocaleString('fr-FR')} MAD → {estimateResult.amountEur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} EUR
              (taux {estimateResult.rateUsed.rate}, {estimateResult.rateUsed.source})
            </p>
          </div>
        )}
      </div>

      {estimates.length > 0 && (
        <div className="card">
          <h2 className="font-display font-bold text-mizan-ardoise mb-4">Estimations Scope 3 précédentes</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-mizan-gris border-b border-mizan-menthe/60">
                <th className="py-2 pr-3">Période</th>
                <th className="py-2 pr-3">Montant (k€)</th>
                <th className="py-2">tCO2e</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((e) => (
                <tr key={e.entry_id} className="border-b border-mizan-menthe/30">
                  <td className="py-2 pr-3 font-data">{e.period_start} → {e.period_end}</td>
                  <td className="py-2 pr-3 font-data">{Number(e.amount_keur).toLocaleString('fr-FR')}</td>
                  <td className="py-2 font-data">{formatTco2e(e.tco2e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
