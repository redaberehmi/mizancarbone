import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { EmptyState } from '../components/EmptyState.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { IconWallet, IconCalculator } from '../components/icons.jsx';

function formatTco2e(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

function formatMad(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}

const SIZE_LABELS = { tpe: 'TPE', pme: 'PME', ge: 'Grande entreprise' };
const SIZE_SOURCE_LABELS = {
  calcule_programme: 'calculée selon le critère propre à ce dispositif',
  calcule_loi5300: 'calculée selon la Charte de la PME (Loi 53-00)',
  declare: 'déclarée dans votre profil',
};
const RULE_STATUS_LABELS = { confirme: 'Confirmé', a_confirmer: 'À confirmer', non_confirme: 'Non confirmé' };
const RULE_VERIFIED_BY_LABELS = { utilisateur: 'vous', recherche_ia: 'recherche IA', claude_code: 'Claude Code' };
const RULE_TYPE_LABELS = { critere_eligibilite: "Critère d'éligibilité", exclusion: 'Exclusion', autre: 'Autre' };
const TIER_LABELS = {
  1: 'Éligible',
  2: 'Éligibilité non déterminée',
  3: 'Non éligible',
};

function CarbonCostSimulator() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ pricePerTco2e: '', currency: 'MAD', year: String(new Date().getFullYear() - 1), scope1: true, scope2: true, scope3: false, scope2Method: 'location' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get('/financing/carbon-cost/status').then(setStatus);
  }, []);
  const run = async (e) => {
    e.preventDefault();
    setError(null);
    const scopes = [form.scope1 && 1, form.scope2 && 2, form.scope3 && 3].filter(Boolean);
    try {
      setResult(await api.post('/financing/carbon-cost/simulate', {
        pricePerTco2e: Number(form.pricePerTco2e), currency: form.currency, scopes, year: Number(form.year), scope2Method: form.scope2Method,
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.');
    }
  };
  return (
    <div className="card space-y-3">
      <SectionHeader icon={IconCalculator} title="Simulation de coût carbone" />
      {status && (
        <div className="rounded-lg border border-mizan-alerte/30 bg-mizan-alerte/5 px-4 py-3 space-y-1">
          <p className="text-sm text-mizan-alerte">{status.disclaimer}</p>
          <p className="text-xs text-mizan-gris">Statut réglementaire (vérifié le {status.regulatoryStatus.checkedOn}) : {status.regulatoryStatus.detail}</p>
        </div>
      )}
      <form onSubmit={run} className="grid md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label-field">Prix par tCO2e (hypothèse)</label>
          <input type="number" min="0" step="any" required className="input-field font-data" value={form.pricePerTco2e} onChange={(e) => setForm({ ...form, pricePerTco2e: e.target.value })} />
        </div>
        <div>
          <label className="label-field">Devise</label>
          <select className="input-field" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option>MAD</option><option>EUR</option><option>USD</option>
          </select>
        </div>
        <div>
          <label className="label-field">Année des émissions</label>
          <input type="number" min="2000" max="2100" required className="input-field font-data" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
        </div>
        <div>
          <label className="label-field">Scope 2 retenu</label>
          <select className="input-field" value={form.scope2Method} onChange={(e) => setForm({ ...form, scope2Method: e.target.value })}>
            <option value="location">Location-based</option>
            <option value="market">Market-based</option>
          </select>
        </div>
        <div className="md:col-span-3 flex flex-wrap gap-4 text-sm">
          <span className="label-field mb-0">Périmètre (hypothèse de simulation) :</span>
          {[1, 2, 3].map((n) => (
            <label key={n} className="flex items-center gap-1"><input type="checkbox" checked={form[`scope${n}`]} onChange={(e) => setForm({ ...form, [`scope${n}`]: e.target.checked })} /> Scope {n}</label>
          ))}
        </div>
        <button type="submit" className="btn-primary">Simuler</button>
      </form>
      {error && <p className="text-sm text-mizan-alerte">{error}</p>}
      {result && result.status === 'non_calculable' && (
        <p className="text-sm text-mizan-alerte">{result.statusDetail}</p>
      )}
      {result && result.status !== 'non_calculable' && (
        <div>
          {result.statusDetail && <p className="text-sm text-mizan-alerte mb-1">{result.statusDetail}</p>}
          <p className="font-data text-2xl text-mizan-ardoise">{formatMad(result.simulatedCost)} {result.currency} <span className="text-sm text-mizan-gris">(simulation{result.status === 'partiel' ? ' partielle' : ''})</span></p>
          <p className="text-sm text-mizan-gris mt-1">
            Hypothèses : {result.assumptions.pricePerTco2e} {result.currency}/tCO2e · Scope {result.assumptions.scopes.join(' + ')}
            {result.assumptions.scope2Method ? ` (Scope 2 ${result.assumptions.scope2Method === 'market' ? 'market-based' : 'location-based'})` : ''} · année {result.assumptions.year} ·
            {' '}émissions retenues <span className="font-data">{formatTco2e(result.consideredTco2e)} tCO2e</span>. {result.note}
          </p>
        </div>
      )}
    </div>
  );
}

export function FinancingWatch() {
  const [eligibility, setEligibility] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/financing/programs'), api.get('/financing/carbon-tax/simulate')]).then(
      ([programsRes, simulationRes]) => {
        setEligibility(programsRes);
        setSimulation(simulationRes);
        setLoading(false);
      },
    );
  }, []);

  if (loading) return null;
  const { programs, sizeCategoryCaveat } = eligibility;

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        icon={IconWallet}
        title="Financements & coût carbone"
        subtitle="Veille des dispositifs de financement et simulation interne de coût carbone (hypothèses explicites, aucune taxe confirmée)."
      />

      <div className="rounded-lg border border-mizan-menthe bg-mizan-menthe/15 px-4 py-3">
        <p className="text-sm text-mizan-ardoise">
          Chaque dispositif peut avoir son propre critère de taille (ex. Tatwir Croissance Verte utilise son propre
          seuil de chiffre d'affaires, distinct de la Charte de la PME) — la taille retenue est précisée sous chacun.
        </p>
        <p className="text-xs text-mizan-gris mt-1">{sizeCategoryCaveat}</p>
      </div>

      <div className="card">
        <SectionHeader icon={IconWallet} title="Dispositifs de financement" />

        {programs.length === 0 ? (
          <EmptyState
            title="Aucun dispositif renseigné pour le moment"
            description="Cette liste est tenue à jour manuellement (subventions, appels à projets, dispositifs d'accompagnement à la décarbonation industrielle). Elle sera complétée dès que des dispositifs vérifiés seront disponibles — revenez consulter cette page régulièrement."
          />
        ) : (
          <div className="space-y-6">
            {[1, 2, 3].map((tier) => {
              const tierPrograms = programs.filter((p) => p.tier === tier);
              if (tierPrograms.length === 0) return null;
              return (
                <div key={tier}>
                  <h3 className="text-xs font-medium text-mizan-gris uppercase tracking-wide mb-2">{TIER_LABELS[tier]}</h3>
                  <div className="space-y-4">
                    {tierPrograms.map((p) => (
            <div key={p.id} className="border border-mizan-menthe/60 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display font-bold text-mizan-ardoise">{p.name}</h3>
                  <div className="flex gap-1.5 shrink-0">
                    {p.isNew && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-mizan-vert text-white font-medium">Nouveau</span>
                    )}
                    {p.eligible === true && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-mizan-vert/10 text-mizan-vert font-medium">Éligible</span>
                    )}
                    {p.eligible === false && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-mizan-gris/10 text-mizan-gris font-medium">Non éligible</span>
                    )}
                    {p.eligible === null && (
                      <span className="text-xs px-2 py-0.5 rounded-full border border-mizan-menthe text-mizan-gris font-medium">Non déterminé</span>
                    )}
                  </div>
                </div>
                {p.description && <p className="text-sm text-mizan-gris mt-1">{p.description}</p>}

                {p.recommendationReason && (
                  <div className="mt-2 rounded-lg bg-mizan-vert/5 border border-mizan-vert/20 px-3 py-2">
                    <p className="text-xs text-mizan-vert font-medium">Recommandé : {p.recommendationReason}</p>
                  </div>
                )}

                {p.undeterminedReason && (
                  <p className="text-xs text-mizan-gris mt-2">{p.undeterminedReason}</p>
                )}

                {p.companySizeCategory && (
                  <p className="text-xs text-mizan-gris mt-1">
                    Taille retenue : <span className="font-data font-medium text-mizan-ardoise">{SIZE_LABELS[p.companySizeCategory]}</span>
                    {' '}({SIZE_SOURCE_LABELS[p.companySizeCategorySource] ?? p.companySizeCategorySource})
                  </p>
                )}

                {p.non_automated_conditions && (
                  <div className="mt-3 rounded-lg border border-mizan-alerte/30 bg-mizan-alerte/5 px-3 py-2">
                    <p className="text-xs text-mizan-alerte">
                      Conditions à vérifier vous-même (non testées automatiquement) : {p.non_automated_conditions}
                    </p>
                  </div>
                )}

                {p.current_edition_label && (
                  <p className="text-xs text-mizan-gris mt-2">
                    Édition en cours : <span className="font-data">{p.current_edition_label}</span>
                  </p>
                )}

                {(p.application_deadline || p.deadline_note) && (
                  <p className="text-xs text-mizan-gris mt-2">
                    Échéance : {p.application_deadline ? <span className="font-data">{p.application_deadline}</span> : p.deadline_note}
                  </p>
                )}

                {p.components.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {p.components.map((c, i) => (
                      <div key={i} className="text-sm bg-mizan-menthe/15 rounded-md px-3 py-1.5">
                        <div className="flex items-baseline justify-between">
                          <span>
                            {c.label}
                            {c.beneficiary_type && <span className="text-mizan-gris"> · {c.beneficiary_type}</span>}
                          </span>
                          <span className="font-data text-mizan-vert">
                            {c.subsidy_rate_pct !== null ? `${Number(c.subsidy_rate_pct)}%` : '—'}
                            {c.cap_amount_mad !== null && ` · plafond ${formatMad(c.cap_amount_mad)} MAD`}
                          </span>
                        </div>
                        {c.notes && <p className="text-xs text-mizan-gris mt-1">{c.notes}</p>}
                      </div>
                    ))}
                    <p className="text-xs text-mizan-gris">
                      Plusieurs volets peuvent se combiner sur un même projet — ce ne sont pas des taux alternatifs.
                    </p>
                  </div>
                )}

                {p.categories.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {p.categories.map((cat) => (
                      <span key={cat} className="text-xs px-2 py-1 rounded-full border border-mizan-menthe text-mizan-gris">
                        {cat}
                      </span>
                    ))}
                  </div>
                )}

                {p.eligibility && <p className="text-sm text-mizan-gris mt-3">Éligibilité : {p.eligibility}</p>}

                {p.rules.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs text-mizan-vert font-medium cursor-pointer select-none">
                      Registre des règles vérifiées ({p.rules.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {p.rules.map((r) => (
                        <div key={r.rule_key} className="text-xs border-l-2 border-mizan-menthe pl-3">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium text-mizan-ardoise">
                              {r.rule_label}
                              <span className="text-mizan-gris font-normal"> · {RULE_TYPE_LABELS[r.rule_type] ?? r.rule_type}</span>
                            </span>
                            <span
                              className={
                                r.status === 'confirme'
                                  ? 'text-mizan-vert font-medium'
                                  : r.status === 'non_confirme'
                                    ? 'text-mizan-alerte font-medium'
                                    : 'text-mizan-gris font-medium'
                              }
                            >
                              {RULE_STATUS_LABELS[r.status] ?? r.status}
                            </span>
                          </div>
                          <p className="text-mizan-gris mt-0.5">{r.rule_detail}</p>
                          <p className="text-mizan-gris mt-0.5">
                            Source : {r.primary_source} · Vérifié par {RULE_VERIFIED_BY_LABELS[r.verified_by] ?? r.verified_by}
                            {' '}le <span className="font-data">{r.verified_at}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {p.source_url && (
                  <a href={p.source_url} target="_blank" rel="noreferrer" className="text-sm text-mizan-vert font-medium mt-2 inline-block">
                    Source →
                  </a>
                )}
              </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CarbonCostSimulator />
    </div>
  );
}
