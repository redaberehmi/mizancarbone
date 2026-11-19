import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { IconFileCheck, IconBuilding, IconCalendar, IconDatabase, IconLeaf } from '../components/icons.jsx';

const TABS = [
  { key: 'couverture', label: 'Couverture du bilan' },
  { key: 'perimetre', label: 'Périmètre' },
  { key: 'annee', label: 'Année de référence' },
  { key: 'verification', label: 'Vérification externe' },
  { key: 'facteurs', label: 'Registre des facteurs' },
];

const RELEVANCE = { pertinente: 'Pertinente', non_pertinente: 'Non pertinente', a_evaluer: 'À évaluer' };
const DATA_STATE = { calcule: 'Calculé', partiel: 'Partiellement calculé', non_calcule: 'Saisi, non calculé', manquant: 'Manquant' };
const ITEM_TYPES = { site: 'Site', entite: 'Entité', operation: 'Opération', actif_loue: 'Actif loué', exclusion: 'Exclusion' };
const TRIGGERS = {
  changement_structurel: 'Changement structurel (acquisition, cession, externalisation)',
  changement_methodologique: 'Changement méthodologique (facteur, méthode de calcul)',
  correction_erreur: "Correction d'erreur",
};
const RECOMMENDATION = {
  recalcul_recommande: 'Recalcul recommandé (seuil atteint, effet cumulé compris)',
  sous_le_seuil: 'Sous le seuil défini par l’entreprise',
  seuil_non_defini: 'Aucun seuil défini : à fixer et documenter par l’entreprise',
  annee_reference_sans_donnees: "Aucune donnée calculée pour l'année de référence",
};
const METHOD_STATUS = { valide_source_primaire: 'Source primaire validée', a_confirmer: 'À confirmer', source_secondaire: 'Source secondaire', non_utilisable: 'Non utilisable', retire: 'Retiré' };
const RIGHTS = { non_applicable: 'Sans objet', a_confirmer: 'À confirmer', confirme: 'Confirmés', refuse: 'Refusés' };

function errMsg(err) {
  return err instanceof ApiError ? err.message : 'Erreur inattendue.';
}

function Coverage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => setData(await api.get('/methodology/coverage'));
  useEffect(() => { load(); }, []);
  if (!data) return null;

  const update = async (src, status) => {
    setError(null);
    let justification = src.justification ?? undefined;
    if (status === 'non_pertinente') {
      justification = window.prompt('Justifiez l’exclusion de cette source :', justification ?? '') ?? '';
      if (!justification.trim()) return;
    }
    try {
      setData(await api.put('/methodology/coverage/relevance', { sourceCode: src.code, status, justification }));
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div className="card space-y-3">
      <SectionHeader icon={IconLeaf} title="Diagnostic des sources d'émission" />
      <p className="text-sm text-mizan-gris -mt-2">{data.note}</p>
      <p className="text-sm text-mizan-ardoise">
        Sources jugées pertinentes : {data.summary.relevantCount} · calculées : {data.summary.relevantCalculated} ·
        à évaluer : {data.summary.toAssessCount}
        {data.summary.relevantMissing.length > 0 && <> · <span className="text-mizan-alerte">manquantes : {data.summary.relevantMissing.length}</span></>}
        {data.summary.relevantUnsupported.length > 0 && <> · <span className="text-mizan-alerte">non prises en charge : {data.summary.relevantUnsupported.length}</span></>}
      </p>
      {error && <p className="text-sm text-mizan-alerte">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Pertinence</th>
              <th className="py-2 pr-3">Données</th>
              <th className="py-2 pr-3">tCO2e</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((s) => (
              <tr key={s.code} className="row-bi border-b border-mizan-menthe/60 align-top">
                <td className="py-2 pr-3">
                  Scope {s.scope} — {s.label}
                  {!s.supported && <span className="badge-non-national ml-2">non pris en charge</span>}
                  {s.supportNote && <p className="text-xs text-mizan-gris">{s.supportNote}</p>}
                  {s.sectorHint && <p className="text-xs text-mizan-gris">Indication MizanCarbone (à confirmer) : {s.sectorHint}</p>}
                  {s.justification && <p className="text-xs text-mizan-gris">Justification : {s.justification}</p>}
                </td>
                <td className="py-2 pr-3">
                  <select className="input-field py-1 text-xs" value={s.relevance} onChange={(e) => update(s, e.target.value)}>
                    {Object.entries(RELEVANCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className={`py-2 pr-3 ${s.dataState === 'calcule' ? '' : 'text-mizan-alerte'}`}>{DATA_STATE[s.dataState]}</td>
                <td className="py-2 pr-3 font-data">{s.tco2e === null ? '—' : Number(s.tco2e).toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Boundary() {
  const [data, setData] = useState(null);
  const [sites, setSites] = useState([]);
  const [desc, setDesc] = useState('');
  const [item, setItem] = useState({ itemType: 'site', name: '', siteId: '', included: true, hasOperationalControl: true, ownershipPct: '', justification: '' });
  const [error, setError] = useState(null);
  const load = async () => {
    const [b, s] = await Promise.all([api.get('/methodology/boundary'), api.get('/companies/me/sites')]);
    setData(b);
    setDesc(b.boundaryDescription ?? '');
    setSites(s.sites);
  };
  useEffect(() => { load(); }, []);
  if (!data) return null;

  const saveBoundary = async (patch) => {
    setError(null);
    try {
      setData(await api.put('/methodology/boundary', patch));
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const addItem = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      setData(await api.post('/methodology/boundary/items', {
        itemType: item.itemType,
        name: item.name,
        siteId: item.siteId ? Number(item.siteId) : null,
        included: item.included,
        hasOperationalControl: item.hasOperationalControl,
        ownershipPct: item.ownershipPct === '' ? null : Number(item.ownershipPct),
        justification: item.justification,
      }));
      setItem({ ...item, name: '', justification: '', ownershipPct: '' });
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="card space-y-3">
        <SectionHeader icon={IconBuilding} title="Approche de consolidation" />
        <p className="text-sm text-mizan-ardoise">{data.approachNote}</p>
        <div>
          <label className="label-field">Rôle de l'entreprise</label>
          <select className="input-field max-w-md" value={data.activityRole} onChange={(e) => saveBoundary({ activityRole: e.target.value })}>
            <option value="consommateur">Consommatrice d'énergie (cas général)</option>
            <option value="producteur_electricite">Installation productrice d'électricité</option>
            <option value="producteur_hydrogene">Installation productrice d'hydrogène</option>
          </select>
          {data.activityRole !== 'consommateur' && (
            <p className="text-xs text-mizan-alerte mt-2">
              Les méthodes propres aux installations productrices (émissions de production, attribution à l'électricité
              ou à l'hydrogène produits, règles CBAM sectorielles) ne sont pas prises en charge : les données utiles
              restent collectées, mais aucun résultat réglementaire n'est produit.
            </p>
          )}
        </div>
        <div>
          <label className="label-field">Description du périmètre retenu</label>
          <textarea className="input-field" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button type="button" className="btn-secondary mt-2" onClick={() => saveBoundary({ boundaryDescription: desc || null })}>Enregistrer</button>
        </div>
      </div>

      <form onSubmit={addItem} className="card space-y-3">
        <SectionHeader icon={IconBuilding} title="Éléments du périmètre (sites, entités, opérations, locations, exclusions)" />
        <p className="text-xs text-mizan-gris -mt-2">
          Le contrôle opérationnel ne se confond pas avec la détention : le pourcentage de détention est
          informatif et n'intervient dans aucun calcul. Seul un élément de type « Site » déclaré exclu retire les données de tout ce site du recalcul de l'année de référence ; l'exclusion d'un équipement, d'une opération ou d'un actif loué est signalée et doit être traduite dans les données saisies.
        </p>
        <div className="grid md:grid-cols-3 gap-3">
          <select className="input-field" value={item.itemType} onChange={(e) => setItem({ ...item, itemType: e.target.value })}>
            {Object.entries(ITEM_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input required placeholder="Nom" className="input-field" value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} />
          <select className="input-field" value={item.siteId} onChange={(e) => setItem({ ...item, siteId: e.target.value })}>
            <option value="">Site associé (optionnel)</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.included} onChange={(e) => setItem({ ...item, included: e.target.checked })} /> Inclus dans le périmètre</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.hasOperationalControl} onChange={(e) => setItem({ ...item, hasOperationalControl: e.target.checked })} /> Contrôle opérationnel</label>
          <input type="number" min="0" max="100" step="any" placeholder="Détention % (informatif)" className="input-field font-data" value={item.ownershipPct} onChange={(e) => setItem({ ...item, ownershipPct: e.target.value })} />
        </div>
        <textarea required minLength={3} placeholder="Justification" className="input-field" rows={2} value={item.justification} onChange={(e) => setItem({ ...item, justification: e.target.value })} />
        {error && <p className="text-sm text-mizan-alerte">{error}</p>}
        <button type="submit" className="btn-primary">Ajouter</button>
        {data.items.length > 0 && (
          <ul className="text-sm divide-y divide-mizan-menthe">
            {data.items.map((i) => (
              <li key={i.id} className="py-2 flex justify-between gap-3">
                <span>
                  <b>{ITEM_TYPES[i.item_type]}</b> — {i.name} · {i.included ? 'inclus' : 'exclu'}
                  {i.has_operational_control !== null ? ` · contrôle opérationnel : ${i.has_operational_control ? 'oui' : 'non'}` : ''}
                  {i.ownership_pct !== null ? ` · détention ${i.ownership_pct} %` : ''}
                  <span className="block text-xs text-mizan-gris">{i.justification}</span>
                </span>
                <button type="button" className="text-mizan-alerte hover:underline" onClick={async () => { await api.delete(`/methodology/boundary/items/${i.id}`); load(); }}>Retirer</button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}

function BaseYear() {
  const [data, setData] = useState(null);
  const [threshold, setThreshold] = useState('');
  const [form, setForm] = useState({ triggerType: 'changement_structurel', description: '', estimatedImpactTco2e: '' });
  const [preview, setPreview] = useState(null);
  const [recalc, setRecalc] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => {
    const d = await api.get('/methodology/base-year');
    setData(d);
    setThreshold(d.thresholdPct ?? '');
  };
  useEffect(() => { load(); }, []);
  if (!data) return null;

  const body = () => ({ triggerType: form.triggerType, description: form.description, estimatedImpactTco2e: Number(form.estimatedImpactTco2e) });
  const doPreview = async () => {
    setError(null);
    try {
      setPreview(await api.post('/methodology/base-year/reviews/preview', body()));
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const record = async () => {
    setError(null);
    try {
      await api.post('/methodology/base-year/reviews', body());
      setPreview(null);
      setForm({ ...form, description: '', estimatedImpactTco2e: '' });
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const decide = async (id, decision) => {
    const note = window.prompt('Note de décision (obligatoire) :') ?? '';
    if (note.trim().length < 5) return;
    await api.patch(`/methodology/base-year/reviews/${id}`, { decision, note });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="card space-y-3">
        <SectionHeader icon={IconCalendar} title={`Politique de recalcul — année de référence ${data.baseYear ?? 'non définie'}`} />
        <p className="text-sm text-mizan-ardoise">{data.policyNote}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label-field">Seuil de significativité choisi par l'entreprise (%)</label>
            <input type="number" min="0" max="100" step="any" className="input-field font-data w-40" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
          <button type="button" className="btn-secondary" onClick={async () => { await api.put('/methodology/base-year/policy', { thresholdPct: threshold === '' ? null : Number(threshold) }); load(); }}>Enregistrer</button>
        </div>
        {data.baseYearTotals && (
          <p className="text-xs text-mizan-gris">
            Base de comparaison (Scope 1 + Scope 2 location-based de l'année de référence) :{' '}
            {data.baseYearTotals.hasData ? `${Number(data.baseYearTotals.totalScope12LocationBased).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} tCO2e` : 'aucune donnée calculée'}.
          </p>
        )}
      </div>

      <div className="card space-y-3">
        <SectionHeader icon={IconCalendar} title="Examiner un changement" />
        <div className="grid md:grid-cols-3 gap-3">
          <select className="input-field" value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}>
            {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="number" step="any" placeholder="Impact estimé sur l'année de référence (tCO2e)" className="input-field font-data md:col-span-2" value={form.estimatedImpactTco2e} onChange={(e) => setForm({ ...form, estimatedImpactTco2e: e.target.value })} />
        </div>
        <textarea placeholder="Description du changement (une variation normale de production n'est pas un motif)" className="input-field" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {error && <p className="text-sm text-mizan-alerte">{error}</p>}
        <div className="flex gap-3">
          <button type="button" className="btn-secondary" onClick={doPreview}>Prévisualiser l'impact</button>
          {preview && <button type="button" className="btn-primary" onClick={record}>Enregistrer l'examen</button>}
        </div>
        {preview && (
          <p className="text-sm text-mizan-ardoise">
            Impact : {preview.impactPct === null ? '—' : `${preview.impactPct.toFixed(2)} %`} · effet cumulé :{' '}
            {preview.cumulativePct === null ? '—' : `${preview.cumulativePct.toFixed(2)} %`} · {RECOMMENDATION[preview.recommendation]}
          </p>
        )}
      </div>

      <div className="card space-y-3">
        <SectionHeader icon={IconCalendar} title="Recalcul versionné de l'inventaire de l'année de référence" />
        <p className="text-xs text-mizan-gris -mt-2">
          Le recalcul reprend les données actuelles de l'année de référence avec le registre actuel, y compris les
          facteurs correctifs. Il est produit quand un examen est validé (« Valider le recalcul ») et conservé comme
          nouvelle version ; la version initiale et les résultats enregistrés ne sont jamais modifiés. La comparaison
          du tableau de bord utilise la dernière version.
        </p>
        <button type="button" className="btn-secondary" onClick={async () => { try { setRecalc(await api.get('/methodology/base-year/recalculation-preview')); } catch (err) { setError(errMsg(err)); } }}>
          Prévisualiser le recalcul
        </button>
        {recalc && (
          <p className="text-sm">
            Base actuelle : {Number(recalc.current?.totalScope12LocationBased ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} tCO2e ·
            après recalcul : {Number(recalc.recalculated.totalScope12LocationBased).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} tCO2e ·
            écart : {Number(recalc.differenceScope12Tco2e).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} tCO2e
            {recalc.recalculated.lines.some((l) => l.issue) && <span className="text-mizan-alerte"> · {recalc.recalculated.lines.filter((l) => l.issue).length} ligne(s) sans facteur utilisable</span>}
          </p>
        )}
        {data.versions.length > 0 && (
          <ul className="text-sm divide-y divide-mizan-menthe">
            {data.versions.map((v) => (
              <li key={v.id} className="py-1">
                Année {v.base_year} · version {v.version_number} ({v.origin === 'initiale' ? 'initiale' : 'recalcul validé'}) ·
                Scope 1 + 2 : <span className="font-data">{Number(v.total_scope12_tco2e).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} tCO2e</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <SectionHeader icon={IconCalendar} title="Historique (les décisions ne sont jamais réécrites)" />
        {data.reviews.length === 0 ? <p className="text-sm text-mizan-gris">Aucun examen enregistré.</p> : (
          <ul className="text-sm divide-y divide-mizan-menthe">
            {data.reviews.map((r) => (
              <li key={r.id} className="py-2">
                <b>{TRIGGERS[r.trigger_type]}</b> — {r.description}
                <span className="block text-xs text-mizan-gris">
                  Impact {r.impact_pct === null ? '—' : `${Number(r.impact_pct).toFixed(2)} %`} · cumulé {r.cumulative_impact_pct === null ? '—' : `${Number(r.cumulative_impact_pct).toFixed(2)} %`} · seuil {r.threshold_pct ?? 'non défini'} · {RECOMMENDATION[r.recommendation]}
                </span>
                {r.decision === 'en_attente' ? (
                  <span className="flex gap-3 mt-1">
                    <button type="button" className="text-mizan-vert hover:underline" onClick={() => decide(r.id, 'recalcul_valide')}>Valider le recalcul</button>
                    <button type="button" className="text-mizan-alerte hover:underline" onClick={() => decide(r.id, 'recalcul_non_retenu')}>Ne pas recalculer</button>
                  </span>
                ) : (
                  <span className="block text-xs">Décision : {r.decision === 'recalcul_valide' ? 'recalcul validé' : 'recalcul non retenu'} — {r.decision_note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Assurance() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ providerName: '', statementDate: '', scopeDescription: '', assuranceLevel: 'limitee', standardReference: '', documentReference: '' });
  const [error, setError] = useState(null);
  const load = async () => setData(await api.get('/methodology/assurance'));
  useEffect(() => { load(); }, []);
  if (!data) return null;
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/methodology/assurance', { ...form, standardReference: form.standardReference || undefined });
      setForm({ ...form, providerName: '', scopeDescription: '', documentReference: '' });
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  return (
    <div className="space-y-6">
      <div className="card border-mizan-alerte/30 bg-mizan-alerte/5">
        <p className="text-sm text-mizan-alerte">{data.note}</p>
        <p className="text-xs text-mizan-gris mt-2">
          Le contrôle interne de chaque donnée se fait dans « Collecte de données » (non contrôlé, contrôle interne
          effectué, anomalie signalée). Il ne remplace pas une vérification indépendante.
        </p>
      </div>
      <form onSubmit={submit} className="card space-y-3">
        <SectionHeader icon={IconFileCheck} title="Enregistrer l'avis d'un organisme indépendant" />
        <div className="grid md:grid-cols-3 gap-3">
          <input required placeholder="Organisme" className="input-field" value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })} />
          <input required type="date" className="input-field font-data" value={form.statementDate} onChange={(e) => setForm({ ...form, statementDate: e.target.value })} />
          <select className="input-field" value={form.assuranceLevel} onChange={(e) => setForm({ ...form, assuranceLevel: e.target.value })}>
            <option value="limitee">Assurance limitée</option>
            <option value="raisonnable">Assurance raisonnable</option>
            <option value="non_precise">Niveau non précisé</option>
          </select>
          <input placeholder="Référentiel (ex. ISO 14064-3)" className="input-field" value={form.standardReference} onChange={(e) => setForm({ ...form, standardReference: e.target.value })} />
          <input required placeholder="Référence du document d'avis" className="input-field md:col-span-2" value={form.documentReference} onChange={(e) => setForm({ ...form, documentReference: e.target.value })} />
        </div>
        <textarea required minLength={5} placeholder="Périmètre couvert par l'avis" className="input-field" rows={2} value={form.scopeDescription} onChange={(e) => setForm({ ...form, scopeDescription: e.target.value })} />
        {error && <p className="text-sm text-mizan-alerte">{error}</p>}
        <button type="submit" className="btn-primary">Enregistrer</button>
      </form>
      <div className="card">
        <SectionHeader icon={IconFileCheck} title="Avis enregistrés" />
        {data.statements.length === 0 ? <p className="text-sm text-mizan-gris">Aucun avis externe enregistré.</p> : (
          <ul className="text-sm divide-y divide-mizan-menthe">
            {data.statements.map((s) => (
              <li key={s.id} className="py-2">
                <b>{s.provider_name}</b> — {String(s.statement_date).slice(0, 10)} — {s.scope_description}
                <span className={`block text-xs ${s.appliesToCurrentInventory ? 'text-mizan-vert' : 'text-mizan-alerte'}`}>
                  {s.appliesToCurrentInventory ? "Porte sur la version actuelle de l'inventaire." : "Porte sur une version antérieure : l'inventaire a été modifié depuis, l'avis ne s'applique pas aux chiffres actuels."}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FactorRegistry() {
  const [factors, setFactors] = useState(null);
  const [imports, setImports] = useState(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    Promise.all([api.get('/methodology/factors'), api.get('/methodology/factor-imports')]).then(([f, i]) => {
      setFactors(f.factors);
      setImports(i);
    });
  }, []);
  const filtered = useMemo(
    () => (factors ?? []).filter((f) => !filter || `${f.label} ${f.category} ${f.source}`.toLowerCase().includes(filter.toLowerCase())),
    [factors, filter],
  );
  if (!factors || !imports) return null;
  return (
    <div className="space-y-6">
      <div className="card space-y-3">
        <SectionHeader icon={IconDatabase} title={`Facteurs d'émission (${factors.length})`} />
        <p className="text-xs text-mizan-gris -mt-2">
          L'année représentée par un facteur est distincte de sa période d'utilisation dans MizanCarbone et de sa date
          d'intégration. Le statut méthodologique et le statut des droits de réutilisation sont indépendants.
        </p>
        <input placeholder="Filtrer…" className="input-field max-w-sm" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="overflow-x-auto max-h-[520px]">
          <table className="w-full text-xs">
            <thead>
              <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
                <th className="py-2 pr-2">Facteur</th>
                <th className="py-2 pr-2">Valeur</th>
                <th className="py-2 pr-2">Périmètre</th>
                <th className="py-2 pr-2">Année représentée</th>
                <th className="py-2 pr-2">Utilisation</th>
                <th className="py-2 pr-2">Source</th>
                <th className="py-2 pr-2">Statuts</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id} className="row-bi border-b border-mizan-menthe/60 align-top">
                  <td className="py-1 pr-2">S{f.scope} — {f.label}</td>
                  <td className="py-1 pr-2 font-data">{Number(f.value_kgco2e)} kgCO2e/{f.unit}{f.uncertainty_pct !== null ? ` ±${f.uncertainty_pct} %` : ''}</td>
                  <td className="py-1 pr-2">{f.boundary ?? '—'}</td>
                  <td className="py-1 pr-2">{f.represented_year ?? '—'}</td>
                  <td className="py-1 pr-2 font-data">{String(f.valid_from).slice(0, 10)} → {f.valid_to ? String(f.valid_to).slice(0, 10) : 'en cours'}</td>
                  <td className="py-1 pr-2">{f.source}{f.source_sheet ? ` (${f.source_sheet} ! ${f.source_cell})` : ''}</td>
                  <td className="py-1 pr-2">{METHOD_STATUS[f.methodological_status]} · droits : {RIGHTS[f.rights_status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card space-y-2">
        <SectionHeader icon={IconDatabase} title="Imports de facteurs" />
        {imports.batches.length === 0 ? (
          <p className="text-sm text-mizan-gris">
            Aucun import appliqué dans cette base. L'import FM6E se lance en ligne de commande (aperçu par défaut) :
            le classeur tiers n'est jamais publié ni ajouté au dépôt.
          </p>
        ) : imports.batches.map((b) => (
          <div key={b.id} className="text-sm">
            <b>Lot {b.id}</b> — {b.source_file} ({b.source_version}) · retenus {b.accepted_count} · inchangés {b.unchanged_count} · écartés {b.rejected_count}
            <ul className="text-xs text-mizan-gris list-disc ml-5">
              {imports.rejections.filter((r) => r.batch_id === b.id).map((r, i) => (
                <li key={i}>{r.sheet} ! {r.cell} — {r.label ?? '—'} : {r.reason}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Methodology() {
  const [tab, setTab] = useState('couverture');
  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        icon={IconFileCheck}
        title="Méthodologie et traçabilité"
        subtitle="Outil de collecte, de calcul et de préparation des inventaires de gaz à effet de serre, avec traçabilité des données et des hypothèses."
      />
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={tab === t.key ? 'btn-primary' : 'btn-secondary'}>{t.label}</button>
        ))}
      </div>
      {tab === 'couverture' && <Coverage />}
      {tab === 'perimetre' && <Boundary />}
      {tab === 'annee' && <BaseYear />}
      {tab === 'verification' && <Assurance />}
      {tab === 'facteurs' && <FactorRegistry />}
    </div>
  );
}
