import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api } from '../api/client.js';
import { EmptyState } from '../components/EmptyState.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { IconHome } from '../components/icons.jsx';

// Tons de la charte graphique (section 3). L'identité Scope 1 / Scope 2 /
// Scope 3 est portée par les libellés d'axe, pas par la couleur : deux verts
// de la charte (vert plein / vert-secondaire) sont trop proches pour être
// distingués de façon fiable en vision des couleurs (validé avec le script
// de la skill dataviz, échec de séparation CVD). Seul le statut "mesuré vs
// estimé" est encodé par la couleur, comme déjà fait pour le Scope 3.
const COLOR_VERT = '#0B6E4F';
const COLOR_VERT_ATTENUE = '#8FC4AE'; // estimation / moins de confiance
const COLOR_ARDOISE = '#33404A';
const COLOR_GRIS = '#5B6670';
// Aligné sur le token Tailwind mizan-menthe (tailwind.config.js) — refonte
// visuelle : ligne de grille neutre plutôt qu'aplat menthe franc.
const COLOR_MENTHE = '#E1E4E6';

function formatTco2e(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

function formatMad(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}

function formatPct(value, digits = 1) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

// Titre de visualisation sobre (semi-gras, taille modeste, sans la police
// display) — cohérent avec un outil analytique plutôt qu'une page vitrine ;
// le contenu du titre (prop `title`) n'est jamais modifié, seul son style l'est.
function ChartCard({ title, children, note, className = '' }) {
  return (
    <div className={`card ${className}`}>
      <h2 className="text-sm font-semibold text-mizan-ardoise mb-3">{title}</h2>
      {children}
      {note && <p className="text-xs text-mizan-gris mt-2 leading-relaxed">{note}</p>}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-mizan-menthe rounded-lg px-3 py-2 shadow-sm text-sm">
      <p className="text-mizan-gris">{label}</p>
      <p className="font-data text-mizan-ardoise">{formatTco2e(payload[0].value)} tCO2e</p>
    </div>
  );
}

// Tuile KPI compacte (charte Power BI, section 5 de la demande) : libellé en
// majuscules discret au-dessus d'une valeur mise en avant — mêmes props,
// même contenu, présentation plus dense qu'une carte pleine hauteur.
function StatTile({ label, value, unit, sub, unavailable }) {
  return (
    <div className="card !p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-mizan-gris">{label}</p>
      {unavailable ? (
        <p className="text-sm text-mizan-gris mt-2">{unavailable}</p>
      ) : (
        <p className="mt-1.5 flex items-baseline gap-1.5">
          <span className="font-data text-2xl font-semibold text-mizan-ardoise leading-none">{value}</span>
          {unit && <span className="text-xs text-mizan-gris">{unit}</span>}
        </p>
      )}
      {sub && <p className="text-xs text-mizan-gris mt-1.5">{sub}</p>}
    </div>
  );
}

// Portion : composition ordinale (statut de vérification), pas une identité
// catégorielle — un dégradé du vert de la charte (plus foncé = plus de
// confiance) plutôt qu'une nouvelle paire de teintes à valider pour la
// distinction daltonienne.
function ProportionBar({ segments }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <p className="text-sm text-mizan-gris">Aucune donnée.</p>;
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden border border-mizan-menthe/60">
        {segments.map((s) => (
          <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} title={s.label} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((s) => (
          <span key={s.label} className="text-xs text-mizan-gris flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label} · <span className="font-data">{formatPct((s.value / total) * 100, 0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const VERIFICATION_LABELS = {
  non_verifie: 'Non vérifié',
  partiellement_verifie: 'Partiellement vérifié',
  totalement_verifie: 'Totalement vérifié',
};

const VERIFICATION_COLORS = {
  non_verifie: COLOR_GRIS,
  partiellement_verifie: COLOR_VERT_ATTENUE,
  totalement_verifie: COLOR_VERT,
};

function yearlyComparisonMessage(reason) {
  switch (reason) {
    case 'base_year_not_set':
      return "Définissez une année de référence dans le profil entreprise.";
    case 'base_year_no_data':
      return "Aucune donnée saisie pour l'année de référence — comparaison impossible.";
    case 'insufficient_history':
      return "Pas encore assez de recul (une seule année de données).";
    default:
      return "Aucune donnée calculée pour le moment.";
  }
}

// Recherche du meilleur candidat "même période, un an plus tôt" dans une
// liste de périodes librement définies par l'utilisateur (pas nécessairement
// des mois calendaires) — comparaison au mieux, jamais fabriquée : si aucune
// période ne tombe raisonnablement à ~1 an d'écart, YoY reste indisponible.
function findYoyPeriod(sortedPeriods, latest) {
  const latestStart = new Date(latest.periodStart);
  const target = new Date(latestStart);
  target.setUTCFullYear(target.getUTCFullYear() - 1);

  let best = null;
  let bestGapDays = Infinity;
  for (const p of sortedPeriods) {
    if (p === latest) continue;
    const gapDays = Math.abs((new Date(p.periodStart) - target) / (1000 * 60 * 60 * 24));
    if (gapDays < bestGapDays) {
      bestGapDays = gapDays;
      best = p;
    }
  }
  return bestGapDays <= 20 ? best : null;
}

export function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/calculations/summary'), api.get('/reports/dashboard-analytics')]).then(
      ([summaryRes, analyticsRes]) => {
        setSummary(summaryRes);
        setAnalytics(analyticsRes);
        setLoading(false);
      },
    );
  }, []);

  if (loading) return null;

  const scopeData = [
    { label: 'Scope 1', tco2e: summary.scope1Tco2e, estimation: false },
    { label: 'Scope 2 — location-based', tco2e: summary.scope2LocationBasedTco2e, estimation: false },
    {
      label: 'Scope 2 — market-based',
      tco2e: summary.scope2MarketBasedTco2e,
      estimation: false,
      defaulted: summary.scope2MarketBasedIsDefaulted,
    },
    { label: 'Scope 3 — estimation', tco2e: summary.scope3Tco2e, estimation: true },
  ];

  const siteData = [...summary.bySite]
    .sort((a, b) => b.totalTco2e - a.totalTco2e)
    .map((s) => ({ label: s.siteName ?? 'Sans site', tco2e: s.totalTco2e }));

  const sortedPeriods = [...summary.byPeriod].sort((a, b) => (a.periodStart > b.periodStart ? 1 : -1));
  const periodData = sortedPeriods.map((p) => ({ label: `${p.periodStart} → ${p.periodEnd}`, tco2e: p.totalTco2e }));

  const latestPeriod = sortedPeriods[sortedPeriods.length - 1];
  const previousPeriod = sortedPeriods.length >= 2 ? sortedPeriods[sortedPeriods.length - 2] : null;
  const momPct = previousPeriod && previousPeriod.totalTco2e > 0
    ? ((latestPeriod.totalTco2e - previousPeriod.totalTco2e) / previousPeriod.totalTco2e) * 100
    : null;
  const yoyPeriod = latestPeriod ? findYoyPeriod(sortedPeriods, latestPeriod) : null;
  const yoyPct = yoyPeriod && yoyPeriod.totalTco2e > 0
    ? ((latestPeriod.totalTco2e - yoyPeriod.totalTco2e) / yoyPeriod.totalTco2e) * 100
    : null;

  const totalCalculated = summary.scope1Tco2e + summary.scope2LocationBasedTco2e;
  const { yearlyComparison, carbonIntensity, taxSimulation, topContributors, quality, completeness, alerts } = analytics;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={IconHome}
        title="Tableau de bord"
        subtitle="Vue d'ensemble de vos émissions, structurée selon le GHG Protocol / ISO 14064-1."
        banner={false}
        actions={
          <>
            <a href="/api/reports/export.csv" className="btn-secondary">Données brutes (CSV)</a>
            <a href="/api/reports/export.pdf" className="btn-secondary">Rapport complet (PDF)</a>
          </>
        }
      />

      {alerts.length > 0 && (
        <div className="rounded-md border border-mizan-alerte/30 bg-mizan-alerte/5 px-4 py-3">
          <h2 className="text-sm font-semibold text-mizan-alerte mb-1.5">Points d'attention</h2>
          <ul className="space-y-1">
            {alerts.map((a, i) => (
              <li key={i} className="text-sm text-mizan-alerte flex items-start gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-mizan-alerte shrink-0" />
                {a.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Émissions totales (Scope 1+2, cumulé)"
          value={formatTco2e(totalCalculated)}
          unit="tCO2e"
        />
        <StatTile
          label="Variation vs année de référence"
          value={yearlyComparison.available ? (
            <span className={yearlyComparison.variationPct >= 0 ? 'text-mizan-alerte' : 'text-mizan-vert'}>
              {yearlyComparison.variationPct >= 0 ? '↑' : '↓'} {formatPct(Math.abs(yearlyComparison.variationPct), 0)}%
            </span>
          ) : null}
          unavailable={!yearlyComparison.available ? yearlyComparisonMessage(yearlyComparison.reason) : null}
          sub={
            (yearlyComparison.available ? `${yearlyComparison.mostRecentYear.year} vs ${yearlyComparison.baseYear.year} · ` : '') +
            'Scope 1+2 uniquement — Scope 3 exclu'
          }
        />
        <StatTile
          label="Intensité carbone"
          value={carbonIntensity !== null ? formatPct(carbonIntensity, 2) : null}
          unit={carbonIntensity !== null ? 'tCO2e/MDH' : null}
          unavailable={
            carbonIntensity === null
              ? (analytics.annualRevenueMad === null
                ? "Renseignez le chiffre d'affaires dans le profil entreprise."
                : yearlyComparisonMessage(yearlyComparison.reason))
              : null
          }
          sub="Scope 1+2 uniquement — Scope 3 exclu"
        />
        <StatTile
          label="Taxe carbone estimée"
          value={taxSimulation.available ? formatMad(taxSimulation.estimatedTaxMad) : null}
          unit={taxSimulation.available ? 'MAD · indicatif' : null}
          unavailable={!taxSimulation.available ? 'Paramètres non encore configurés.' : null}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
      <ChartCard
        title="Répartition par scope"
        note="Scope 3 (teinte atténuée) est une estimation spend-based — incertitude 30–80%, jamais présentée avec le même niveau de confiance que le Scope 1/2, calculés à partir de données d'activité physiques. Le Scope 2 market-based reste identique au location-based tant qu'aucun contrat d'électricité spécifique n'est renseigné."
      >
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={scopeData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke={COLOR_MENTHE} />
              <XAxis dataKey="label" tick={{ fill: COLOR_GRIS, fontSize: 11 }} axisLine={{ stroke: COLOR_MENTHE }} tickLine={false} />
              <YAxis tick={{ fill: COLOR_GRIS, fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: COLOR_MENTHE, opacity: 0.3 }} />
              <Bar dataKey="tco2e" radius={[4, 4, 0, 0]} maxBarSize={64} isAnimationActive={false}>
                {scopeData.map((entry) => (
                  <Cell
                    key={entry.label}
                    fill={entry.estimation ? COLOR_VERT_ATTENUE : COLOR_VERT}
                    fillOpacity={entry.defaulted ? 0.55 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Répartition par site" note={`${siteData.length} site(s) avec données calculées, classés par émissions décroissantes.`}>
        {siteData.length === 0 ? (
          <EmptyState
            title="Aucune donnée par site pour le moment"
            description="Ce graphique s'alimentera automatiquement dès qu'au moins une entrée d'activité aura été calculée pour un site (module Collecte de données)."
          />
        ) : (
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={siteData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid vertical={false} stroke={COLOR_MENTHE} />
                <XAxis dataKey="label" tick={{ fill: COLOR_GRIS, fontSize: 12 }} axisLine={{ stroke: COLOR_MENTHE }} tickLine={false} />
                <YAxis tick={{ fill: COLOR_GRIS, fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: COLOR_MENTHE, opacity: 0.3 }} />
                <Bar dataKey="tco2e" fill={COLOR_VERT} radius={[4, 4, 0, 0]} maxBarSize={64} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
      <ChartCard title="Top 5 postes d'émission" note="Tous sites et scopes confondus — pour identifier où agir en premier.">
        {topContributors.length === 0 ? (
          <EmptyState
            title="Aucun poste calculé pour le moment"
            description="Ce classement s'alimentera dès que des émissions auront été calculées."
          />
        ) : (
          <div style={{ width: '100%', height: Math.max(160, topContributors.length * 48) }}>
            <ResponsiveContainer>
              <BarChart
                layout="vertical"
                data={topContributors.map((c) => ({ label: c.label, tco2e: c.totalTco2e, pct: c.pctOfTotal }))}
                margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
              >
                <CartesianGrid horizontal={false} stroke={COLOR_MENTHE} />
                <XAxis type="number" tick={{ fill: COLOR_GRIS, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" tick={{ fill: COLOR_GRIS, fontSize: 12 }} axisLine={false} tickLine={false} width={220} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: COLOR_MENTHE, opacity: 0.3 }} />
                <Bar dataKey="tco2e" fill={COLOR_VERT} radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>
      </div>

      <ChartCard title="Qualité méthodologique">
        <div className="grid sm:grid-cols-3 gap-6">
          <div>
            <p className="label-field mb-2">Part de facteurs nationaux</p>
            {quality.nationalSharePct === null ? (
              <p className="text-sm text-mizan-gris">Non disponible.</p>
            ) : (
              <ProportionBar
                segments={[
                  { label: 'Facteurs nationaux', value: quality.nationalSharePct, color: COLOR_VERT },
                  { label: 'Facteurs génériques', value: 100 - quality.nationalSharePct, color: COLOR_GRIS },
                ]}
              />
            )}
          </div>
          <div>
            <p className="label-field mb-2">Statut de vérification</p>
            {quality.verificationBreakdown.length === 0 ? (
              <p className="text-sm text-mizan-gris">Non disponible.</p>
            ) : (
              <ProportionBar
                segments={quality.verificationBreakdown.map((v) => ({
                  label: VERIFICATION_LABELS[v.status] ?? v.status,
                  value: v.pctOfTotal,
                  color: VERIFICATION_COLORS[v.status] ?? COLOR_GRIS,
                }))}
              />
            )}
          </div>
          <div>
            <p className="label-field mb-2">Complétude des données</p>
            {completeness.available ? (
              <>
                <p className="font-data text-2xl text-mizan-ardoise">{formatPct(completeness.completenessPct, 0)}%</p>
                <p className="text-xs text-mizan-gris">
                  {completeness.siteCount} site(s) × {completeness.expectedPeriods} période(s) attendue(s)
                </p>
              </>
            ) : (
              <p className="text-sm text-mizan-gris">
                {completeness.reason === 'reporting_frequency_not_set'
                  ? 'Renseignez une fréquence de reporting dans le profil entreprise.'
                  : 'Non disponible.'}
              </p>
            )}
          </div>
        </div>
      </ChartCard>

      <ChartCard title="Évolution dans le temps">
        {periodData.length < 2 ? (
          <EmptyState
            title="Pas encore assez de périodes pour une évolution"
            description="Ajoutez des données sur au moins deux périodes différentes (module Collecte de données) pour voir apparaître une tendance ici."
          />
        ) : (
          <>
            <div className="flex gap-6 mb-4">
              <div>
                <p className="text-xs text-mizan-gris">Variation vs période précédente</p>
                <p className="font-data text-lg text-mizan-ardoise">
                  {momPct !== null ? `${momPct >= 0 ? '↑' : '↓'} ${formatPct(Math.abs(momPct), 0)}%` : 'Non disponible'}
                </p>
              </div>
              <div>
                <p className="text-xs text-mizan-gris">Variation vs période équivalente N-1</p>
                <p className="font-data text-lg text-mizan-ardoise">
                  {yoyPct !== null ? `${yoyPct >= 0 ? '↑' : '↓'} ${formatPct(Math.abs(yoyPct), 0)}%` : 'Non disponible'}
                </p>
              </div>
            </div>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={periodData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke={COLOR_MENTHE} />
                  <XAxis dataKey="label" tick={{ fill: COLOR_GRIS, fontSize: 11 }} axisLine={{ stroke: COLOR_MENTHE }} tickLine={false} />
                  <YAxis tick={{ fill: COLOR_GRIS, fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: COLOR_MENTHE, opacity: 0.3 }} />
                  <Bar dataKey="tco2e" fill={COLOR_ARDOISE} radius={[4, 4, 0, 0]} maxBarSize={64} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </ChartCard>
    </div>
  );
}
