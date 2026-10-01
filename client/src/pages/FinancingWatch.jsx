import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { EmptyState } from '../components/EmptyState.jsx';

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
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="font-display font-bold text-2xl text-mizan-ardoise">Financements & taxe carbone</h1>
        <p className="text-mizan-gris text-sm mt-1">
          Veille des dispositifs de financement et simulation indicative de la taxe carbone nationale.
        </p>
      </div>

      <div className="rounded-lg border border-mizan-menthe bg-mizan-menthe/15 px-4 py-3">
        <p className="text-sm text-mizan-ardoise">
          Chaque dispositif peut avoir son propre critère de taille (ex. Tatwir Croissance Verte utilise son propre
          seuil de chiffre d'affaires, distinct de la Charte de la PME) — la taille retenue est précisée sous chacun.
        </p>
        <p className="text-xs text-mizan-gris mt-1">{sizeCategoryCaveat}</p>
      </div>

      <div className="card">
        <h2 className="font-display font-bold text-mizan-ardoise mb-4">Dispositifs de financement</h2>

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
