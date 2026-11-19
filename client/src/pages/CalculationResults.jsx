import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { IconInput } from '../components/FormField.jsx';
import { IconCalculator, IconMapPin, IconCalendar, IconFileCheck, IconCoins, IconTrendingUp } from '../components/icons.jsx';

function formatTco2e(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

// Doit rester synchronisé avec SECTORS côté serveur (auth.validation.js).
const SECTOR_LABELS = {
  automobile: 'Automobile',
  textile: 'Textile',
  agroalimentaire: 'Agroalimentaire',
  metallurgie: 'Métallurgie',
  fer_et_acier: 'Fer et acier',
  aluminium: 'Aluminium',
  ciment: 'Ciment',
  engrais: 'Engrais',
  electricite: 'Électricité',
  hydrogene: 'Hydrogène',
};

// Même vocabulaire que les rapports PDF (report-formatting.js) : un poste
// sans donnée ou sans calcul n'affiche jamais « 0 ».
function isNotCalculated(statusInfo) {
  return statusInfo?.status === 'manquant' || statusInfo?.status === 'non_calcule';
}

function ScopeValue({ value, status, note, missingLabel, large }) {
  if (isNotCalculated(status)) {
    const label = status.status === 'non_calcule' ? 'Non calculé' : (missingLabel ?? 'Manquant');
    return (
      <>
        <p className="font-data text-2xl text-mizan-gris">{label}</p>
        <p className="text-xs text-mizan-gris">
          {status.status === 'non_calcule' ? 'données saisies, aucun facteur applicable' : 'aucune donnée pour ce poste'}
        </p>
      </>
    );
  }
  return (
    <>
      <p className="font-data text-2xl text-mizan-ardoise">
        {formatTco2e(value)}
        {large && <span className="text-base"> tCO2e</span>}
      </p>
      {!large && <p className="text-xs text-mizan-gris">tCO2e{note && ` — ${note}`}</p>}
    </>
  );
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
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        icon={IconCalculator}
        title="Calcul des émissions"
        subtitle="Périmètre organisationnel : contrôle opérationnel. Chaque résultat est calculé ligne par ligne avec un facteur versionné et sourcé."
        actions={
          <button onClick={handleRun} disabled={running} className="btn-secondary">
            {running ? 'Calcul…' : 'Recalculer Scope 1 & 2'}
          </button>
        }
      />

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
          <ScopeValue value={summary.scope1Tco2e} status={summary.scope1Status} />
        </div>
        <div className="card">
          <p className="label-field">Scope 2 — location-based</p>
          <ScopeValue value={summary.scope2LocationBasedTco2e} status={summary.scope2LocationBasedStatus} />
        </div>
        <div className="card">
          <p className="label-field">Scope 2 — market-based</p>
          <ScopeValue
            value={summary.scope2MarketBasedTco2e}
            status={summary.scope2MarketBasedStatus}
            note={summary.scope2MarketBasedIsDefaulted ? 'aucun instrument admissible : facteur réseau utilisé faute de mix résiduel (voir page Électricité)' : 'instruments contractuels admissibles appliqués (voir page Électricité)'}
          />
        </div>
      </div>

      <div className="card border-mizan-alerte/30">
        <p className="label-field">Scope 3 — catégories renseignées (estimation partielle)</p>
        <ScopeValue value={summary.scope3Tco2e} status={summary.scope3Status} missingLabel="Non estimé" large />
        {summary.scope3Uncertainty && (
          <p className="text-sm text-mizan-alerte mt-1">
            Incertitude estimée : {summary.scope3Uncertainty.minPercent}–{summary.scope3Uncertainty.maxPercent}%.{' '}
            {summary.scope3Uncertainty.note}
          </p>
        )}
        {isNotCalculated(summary.scope3Status) && (
          <p className="text-sm text-mizan-gris mt-1">
            Aucune estimation Scope 3 enregistrée : ce n'est pas un zéro, le Scope 3 n'est simplement pas encore
            estimé. Une fois disponible, il restera présenté comme une estimation, jamais avec le même niveau de
            confiance que le Scope 1/2.
          </p>
        )}
      </div>

      <div className="card">
        <SectionHeader icon={IconMapPin} title="Répartition par site" />
        {summary.bySite.length === 0 ? (
          <p className="text-sm text-mizan-gris">Aucun résultat calculé pour le moment.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
                <th className="py-2 pr-3">Site</th>
                <th className="py-2">Total (tCO2e)</th>
              </tr>
            </thead>
            <tbody>
              {summary.bySite.map((s) => (
                <tr key={s.siteId ?? 'sans-site'} className="row-bi border-b border-mizan-menthe/60">
                  <td className="py-2 pr-3">{s.siteName ?? 'Sans site (estimation Scope 3)'}</td>
                  <td className="py-2 font-data">{formatTco2e(s.totalTco2e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <SectionHeader icon={IconCalendar} title="Répartition par période" />
        {summary.byPeriod.length === 0 ? (
          <p className="text-sm text-mizan-gris">Aucun résultat calculé pour le moment.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
                <th className="py-2 pr-3">Période</th>
                <th className="py-2">Total (tCO2e)</th>
              </tr>
            </thead>
            <tbody>
              {summary.byPeriod.map((p) => (
                <tr key={`${p.periodStart}_${p.periodEnd}`} className="row-bi border-b border-mizan-menthe/60">
                  <td className="py-2 pr-3 font-data">{p.periodStart} → {p.periodEnd}</td>
                  <td className="py-2 font-data">{formatTco2e(p.totalTco2e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <SectionHeader icon={IconFileCheck} title="Répartition par produit" />
        <p className="text-sm text-mizan-gris mb-4 -mt-2">
          Alimentée par la répartition produit du Module 4 (préparation CBAM) — tant qu'aucune allocation
          n'est renseignée, tout retombe dans « Non alloué ».
        </p>
        {summary.byProduct.length === 0 ? (
          <p className="text-sm text-mizan-gris">Aucun résultat calculé pour le moment.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
                <th className="py-2 pr-3">Produit</th>
                <th className="py-2">Total (tCO2e)</th>
              </tr>
            </thead>
            <tbody>
              {summary.byProduct.map((p) => (
                <tr key={p.productAllocation ?? 'non-alloue'} className="row-bi border-b border-mizan-menthe/60">
                  <td className="py-2 pr-3">{p.productAllocation ?? 'Non alloué'}</td>
                  <td className="py-2 font-data">{formatTco2e(p.totalTco2e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <SectionHeader icon={IconTrendingUp} title="Scope 1 — détail par poste" />
        <table className="w-full text-sm">
          <tbody>
            {summary.scope1Breakdown.map((b) => (
              <tr key={b.category} className="row-bi border-b border-mizan-menthe/60">
                <td className="py-2 pr-3">{b.label}</td>
                <td className="py-2 font-data">{b.tco2e === null ? (b.status === 'non_calcule' ? 'Non calculé' : 'Manquant') : formatTco2e(b.tco2e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <SectionHeader icon={IconTrendingUp} title="Scope 3 — catégories et couverture" />
        <p className="text-sm text-mizan-gris mb-4 -mt-2">
          Estimation partielle : {summary.scope3Coverage.categoriesWithData} catégorie(s) sur 15 renseignée(s). Les
          achats se saisissent par catégorie dans « Collecte de données », avec un facteur adapté (quantité physique
          ou ratio monétaire justifié). La pertinence de chaque catégorie se déclare dans « Méthodologie ».
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
              <th className="py-2 pr-3">Catégorie</th>
              <th className="py-2 pr-3">Pertinence</th>
              <th className="py-2">tCO2e</th>
            </tr>
          </thead>
          <tbody>
            {summary.scope3Breakdown.map((c) => (
              <tr key={c.category} className="row-bi border-b border-mizan-menthe/60">
                <td className="py-2 pr-3">{c.category} — {c.label}</td>
                <td className="py-2 pr-3">{{ pertinente: 'Pertinente', non_pertinente: 'Non pertinente', a_evaluer: 'À évaluer' }[c.relevance]}</td>
                <td className="py-2 font-data">{c.tco2e === null ? (c.status === 'non_calcule' ? 'Non calculé' : 'Manquant') : formatTco2e(c.tco2e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-mizan-gris mt-3">{readiness.legacySectorRatio.reason}</p>
      </div>

      {estimates.length > 0 && (
        <div className="card">
          <SectionHeader icon={IconTrendingUp} title="Estimations historiques par ratio sectoriel (méthode isolée)" />
          <table className="w-full text-sm">
            <thead>
              <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
                <th className="py-2 pr-3">Période</th>
                <th className="py-2 pr-3">Montant (k€)</th>
                <th className="py-2">tCO2e</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((e) => (
                <tr key={e.entry_id} className="row-bi border-b border-mizan-menthe/60">
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
