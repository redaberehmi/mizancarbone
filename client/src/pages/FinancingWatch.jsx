import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { EmptyState } from '../components/EmptyState.jsx';

function formatTco2e(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

function formatMad(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}

export function FinancingWatch() {
  const [programs, setPrograms] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/financing/programs'), api.get('/financing/carbon-tax/simulate')]).then(
      ([programsRes, simulationRes]) => {
        setPrograms(programsRes.programs);
        setSimulation(simulationRes);
        setLoading(false);
      },
    );
  }, []);

  if (loading) return null;

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="font-display font-bold text-2xl text-mizan-ardoise">Financements & taxe carbone</h1>
        <p className="text-mizan-gris text-sm mt-1">
          Veille des dispositifs de financement et simulation indicative de la taxe carbone nationale.
        </p>
      </div>

      <div className="card">
        <h2 className="font-display font-bold text-mizan-ardoise mb-4">Dispositifs de financement</h2>

        {programs.length === 0 ? (
          <EmptyState
            title="Aucun dispositif renseigné pour le moment"
            description="Cette liste est tenue à jour manuellement (subventions, appels à projets, dispositifs d'accompagnement à la décarbonation industrielle). Elle sera complétée dès que des dispositifs vérifiés seront disponibles — revenez consulter cette page régulièrement."
          />
        ) : (
          <div className="space-y-4">
            {programs.map((p) => (
              <div key={p.id} className="border border-mizan-menthe/60 rounded-lg p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display font-bold text-mizan-ardoise">{p.name}</h3>
                  {p.subsidy_rate !== null && (
                    <span className="font-data text-mizan-vert">{p.subsidy_rate}%</span>
                  )}
                </div>
                {p.description && <p className="text-sm text-mizan-gris mt-1">{p.description}</p>}
                <div className="text-sm text-mizan-gris mt-2 space-y-0.5">
                  {p.cap_amount_mad !== null && (
                    <p>Plafond : <span className="font-data">{formatMad(p.cap_amount_mad)} MAD</span></p>
                  )}
                  {p.eligibility && <p>Éligibilité : {p.eligibility}</p>}
                </div>
                {p.source_url && (
                  <a href={p.source_url} target="_blank" rel="noreferrer" className="text-sm text-mizan-vert font-medium">
                    Source →
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-display font-bold text-mizan-ardoise mb-1">Simulateur — taxe carbone nationale</h2>
        <p className="text-sm text-mizan-gris mb-4">
          {simulation.available
            ? "Vos émissions sont calculées par scope ci-dessous ; le périmètre retenu pour la taxe est précisé dans l'encart en dessous."
            : "Le périmètre de scopes réellement soumis à la taxe n'est pas encore fixé par la Loi de Finances 2026 — vos émissions sont déjà calculées par scope ci-dessous, prêtes à être combinées dès que ce périmètre sera confirmé."}
        </p>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg bg-mizan-menthe/20 border border-mizan-menthe px-3 py-2">
            <p className="text-xs text-mizan-gris">Scope 1</p>
            <p className="font-data text-lg text-mizan-ardoise">{formatTco2e(simulation.breakdown.scope1Tco2e)}</p>
          </div>
          <div className="rounded-lg bg-mizan-menthe/20 border border-mizan-menthe px-3 py-2">
            <p className="text-xs text-mizan-gris">Scope 2 (location-based)</p>
            <p className="font-data text-lg text-mizan-ardoise">{formatTco2e(simulation.breakdown.scope2LocationBasedTco2e)}</p>
          </div>
          <div className="rounded-lg bg-mizan-menthe/20 border border-mizan-menthe px-3 py-2">
            <p className="text-xs text-mizan-gris">Scope 3 (estimation)</p>
            <p className="font-data text-lg text-mizan-ardoise">{formatTco2e(simulation.breakdown.scope3Tco2e)}</p>
          </div>
        </div>

        {!simulation.available ? (
          <EmptyState
            title="Simulateur en attente du taux et du périmètre officiels"
            description="Ni le taux ni le périmètre de scopes soumis à la taxe carbone nationale ne sont encore stabilisés (Loi de Finances 2026). Dès qu'ils seront publiés et intégrés, la simulation s'appliquera automatiquement à vos émissions déjà calculées ci-dessus."
          />
        ) : (
          <div>
            <div className="rounded-lg border border-mizan-alerte/30 bg-mizan-alerte/5 px-4 py-3 mb-4 space-y-1">
              <p className="text-sm text-mizan-alerte">
                Base de calcul actuelle : Scope {[...simulation.taxableScopes].sort().join(' + ')} — hypothèse
                en attente de confirmation par la Loi de Finances 2026.
              </p>
              <p className="text-sm text-mizan-alerte">
                Estimation indicative — les paramètres restent susceptibles d'évoluer tant que la LF2026 n'est
                pas pleinement stabilisée. Source : {simulation.source}.
              </p>
            </div>
            <p className="font-data text-2xl text-mizan-ardoise">
              {formatMad(simulation.estimatedTaxMad)} MAD
            </p>
            <p className="text-sm text-mizan-gris mt-1">
              Total retenu : <span className="font-data">{formatTco2e(simulation.totalTco2eConsidered)} tCO2e</span> ·
              {' '}Taux : <span className="font-data">{simulation.ratePerTco2e} MAD/tCO2e</span>
              {simulation.thresholdTco2e !== null && (
                <> · Seuil d'assujettissement : <span className="font-data">{formatTco2e(simulation.thresholdTco2e)} tCO2e</span>
                  {' '}({simulation.aboveThreshold ? 'dépassé' : 'non atteint'})</>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
