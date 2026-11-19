import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { IconLeaf, IconFileCheck, IconCalculator } from '../components/icons.jsx';

const STATUS_LABELS = {
  admissible: 'Admissible — appliqué',
  non_admissible: 'Non admissible — facteur de repli',
  periode_incompatible: 'Période incompatible',
  sans_consommation: 'Sans consommation',
  surallocation: 'Dépasse la consommation',
  information: 'Information (non déduit)',
};

function kwh(v) {
  return `${Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh`;
}
function t(v) {
  return v === null || v === undefined ? 'Non calculé' : `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} tCO2e`;
}

const emptyForm = {
  siteId: '', instrumentType: 'contrat_fourniture_direct', supplier: '', installation: '', technology: '',
  periodStart: '', periodEnd: '', volumeKwh: '', factorKgco2ePerKwh: '', factorSource: '', documentReference: '', notes: '',
  qc_conveys_attribute: false, qc_unique_claim: false, qc_retired_on_behalf: false, qc_vintage_close_to_period: false, qc_same_market: false,
  qc_supplier_delivered_basis: false, qc_direct_claims_transferred: false,
};

export function ElectricityContracts() {
  const [reference, setReference] = useState(null);
  const [mb, setMb] = useState(null);
  const [summary, setSummary] = useState(null);
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);

  async function load() {
    const [ref, market, sum, s] = await Promise.all([
      api.get('/electricity/reference'),
      api.get('/electricity/market-based'),
      api.get('/calculations/summary'),
      api.get('/companies/me/sites'),
    ]);
    setReference(ref);
    setMb(market);
    setSummary(sum);
    setSites(s.sites);
  }

  useEffect(() => {
    load();
  }, []);

  if (!reference || !mb || !summary) return null;

  const isPurchase = !['autoconsommation', 'vente_electricite'].includes(form.instrumentType);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/electricity/contracts', {
        siteId: Number(form.siteId),
        instrumentType: form.instrumentType,
        supplier: form.supplier || undefined,
        installation: form.installation || undefined,
        technology: form.technology || undefined,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        volumeKwh: Number(form.volumeKwh),
        factorKgco2ePerKwh: isPurchase && form.factorKgco2ePerKwh !== '' ? Number(form.factorKgco2ePerKwh) : null,
        factorSource: form.factorSource || undefined,
        documentReference: form.documentReference || undefined,
        notes: form.notes || undefined,
        qcConveysAttribute: form.qc_conveys_attribute,
        qcUniqueClaim: form.qc_unique_claim,
        qcRetiredOnBehalf: form.qc_retired_on_behalf,
        qcVintageCloseToPeriod: form.qc_vintage_close_to_period,
        qcSameMarket: form.qc_same_market,
        qcSupplierDeliveredBasis: form.qc_supplier_delivered_basis,
        qcDirectClaimsTransferred: form.qc_direct_claims_transferred,
      });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement.');
    }
  };

  const remove = async (id) => {
    await api.delete(`/electricity/contracts/${id}`);
    await load();
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        icon={IconLeaf}
        title="Électricité — location-based et market-based"
        subtitle="La consommation d'électricité achetée est saisie une seule fois (Collecte de données). Les contrats et certificats en sont des allocations : ils ne s'ajoutent jamais à la consommation."
      />

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card">
          <SectionHeader icon={IconCalculator} title="Scope 2 — location-based" />
          <p className="text-2xl font-data text-mizan-ardoise">{t(summary.scope2LocationBasedTco2e)}</p>
          <p className="text-xs text-mizan-gris mt-2">Toute l'électricité achetée × facteur du réseau de la période.</p>
        </div>
        <div className="card">
          <SectionHeader icon={IconCalculator} title="Scope 2 — market-based" />
          <p className="text-2xl font-data text-mizan-ardoise">{t(mb.status.status === 'manquant' ? null : mb.totalTco2e)}</p>
          <p className="text-xs text-mizan-gris mt-2">
            Consommation {kwh(mb.consumptionKwh)} · couverte par des instruments admissibles {kwh(mb.admissibleKwh)} ·
            facteur de repli {kwh(mb.fallbackKwh)}.
          </p>
        </div>
      </div>
      <div className="card border-mizan-alerte/30 bg-mizan-alerte/5">
        <p className="text-sm text-mizan-alerte">
          Les deux résultats sont présentés séparément et ne s'additionnent jamais. {mb.fallbackNote}
        </p>
      </div>
      {(mb.selfConsumptionKwh > 0 || mb.soldKwh > 0) && (
        <p className="text-sm text-mizan-gris">
          Autoconsommation déclarée : {kwh(mb.selfConsumptionKwh)} (pas d'émission Scope 2). Électricité vendue : {kwh(mb.soldKwh)} (jamais déduite des émissions).
        </p>
      )}

      <form onSubmit={submit} className="card space-y-3">
        <SectionHeader icon={IconFileCheck} title="Ajouter un instrument ou une information" />
        <p className="text-xs text-mizan-gris -mt-2">
          Un contrat d'électricité renouvelable n'est jamais présumé admissible ni présumé à facteur nul : le
          facteur direct de l'instrument, sa source, une pièce justificative et les critères de qualité du
          GHG Protocol (Scope 2 Guidance, tableau 7.1) applicables à ce type d'instrument doivent être renseignés
          (critère 6 pour un taux ou contrat fournisseur, critère 7 pour un achat direct auprès d'un producteur).
          Chaque contrôle d'allocation se fait consommation par consommation, au prorata.
        </p>
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="label-field">Site</label>
            <select required className="input-field" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="" disabled>Choisir…</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label-field">Type</label>
            <select className="input-field" value={form.instrumentType} onChange={(e) => setForm({ ...form, instrumentType: e.target.value })}>
              {Object.entries(reference.instrumentLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label-field">Début de période</label>
            <input type="date" required className="input-field font-data" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Fin de période</label>
            <input type="date" required className="input-field font-data" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Volume (kWh)</label>
            <input type="number" step="any" min="0" required className="input-field font-data" value={form.volumeKwh} onChange={(e) => setForm({ ...form, volumeKwh: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Fournisseur</label>
            <input className="input-field" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Installation de production</label>
            <input className="input-field" value={form.installation} onChange={(e) => setForm({ ...form, installation: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Technologie</label>
            <input className="input-field" value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })} />
          </div>
          {isPurchase && (
            <>
              <div>
                <label className="label-field">Facteur direct de l'instrument (kgCO2e/kWh)</label>
                <input type="number" step="any" min="0" className="input-field font-data" value={form.factorKgco2ePerKwh} onChange={(e) => setForm({ ...form, factorKgco2ePerKwh: e.target.value })} />
              </div>
              <div>
                <label className="label-field">Source du facteur</label>
                <input className="input-field" value={form.factorSource} onChange={(e) => setForm({ ...form, factorSource: e.target.value })} />
              </div>
              <div>
                <label className="label-field">Pièce justificative (référence)</label>
                <input className="input-field" value={form.documentReference} onChange={(e) => setForm({ ...form, documentReference: e.target.value })} />
              </div>
            </>
          )}
        </div>
        {isPurchase && (
          <fieldset className="space-y-1">
            <legend className="label-field">Critères de qualité déclarés par l'entreprise</legend>
            {reference.qualityCriteria.filter((q) => !q.appliesTo || q.appliesTo.includes(form.instrumentType)).map((q) => (
              <label key={q.key} className="flex items-start gap-2 text-sm text-mizan-ardoise">
                <input type="checkbox" className="mt-1" checked={form[q.key]} onChange={(e) => setForm({ ...form, [q.key]: e.target.checked })} />
                <span>{q.label}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div>
          <label className="label-field">Notes (optionnel)</label>
          <input className="input-field" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error && <p className="text-sm text-mizan-alerte">{error}</p>}
        <button type="submit" className="btn-primary">Enregistrer</button>
      </form>

      <div className="card">
        <SectionHeader icon={IconFileCheck} title="Instruments enregistrés" />
        {mb.contracts.length === 0 ? (
          <p className="text-sm text-mizan-gris">Aucun instrument : le market-based est calculé intégralement avec le facteur de repli.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
                  <th className="py-2 pr-3">Site</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Période</th>
                  <th className="py-2 pr-3">Volume</th>
                  <th className="py-2 pr-3">Facteur</th>
                  <th className="py-2 pr-3">Statut</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {mb.contracts.map((c) => (
                  <tr key={c.id} className="row-bi border-b border-mizan-menthe/60 align-top">
                    <td className="py-2 pr-3">{c.siteName}</td>
                    <td className="py-2 pr-3">{c.instrumentLabel}{c.technology ? ` — ${c.technology}` : ''}</td>
                    <td className="py-2 pr-3 font-data">{c.periodStart} → {c.periodEnd}</td>
                    <td className="py-2 pr-3 font-data">{kwh(c.volumeKwh)}</td>
                    <td className="py-2 pr-3 font-data">{c.factorKgco2ePerKwh === null ? '—' : `${c.factorKgco2ePerKwh} kgCO2e/kWh`}</td>
                    <td className="py-2 pr-3">
                      <span className={c.status === 'admissible' ? 'text-mizan-vert' : 'text-mizan-alerte'}>{STATUS_LABELS[c.status]}</span>
                      <p className="text-xs text-mizan-gris">{c.statusDetail}</p>
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => remove(c.id)} className="text-mizan-alerte hover:underline">Retirer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
