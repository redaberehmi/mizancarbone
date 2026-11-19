import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { IconFileCheck, IconBuilding } from '../components/icons.jsx';

const STATUS = {
  calcule_valeurs_reelles: 'Calculé à partir de valeurs réelles de l’installation',
  incomplet: 'Incomplet — éléments manquants',
  non_pris_en_charge: 'Non pris en charge par MizanCarbone',
};
const CN_STATUS = {
  liste_annexe_I: "Code figurant dans la liste de l'annexe I (indication)",
  a_preciser: 'Code trop court : précisez les 8 chiffres',
  hors_liste_annexe_I: "Code hors de la liste de l'annexe I (indication)",
  code_invalide: 'Code invalide',
};

function num(v, digits = 6) {
  return v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

function ProcessCard({ p, entries, onChange }) {
  const [link, setLink] = useState({ activityEntryId: '', sharePct: '100' });
  const [error, setError] = useState(null);
  const eligible = entries.filter((e) => e.factor_scope === 1 || e.factor_category === 'electricite_location_based');

  const add = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/cbam/processes/${p.id}/entries`, { activityEntryId: Number(link.activityEntryId), sharePct: Number(link.sharePct) });
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.');
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-display font-semibold text-mizan-ardoise">
          {p.name} — {p.productName} <span className="font-data text-sm text-mizan-gris">NC {p.cnCode}</span>
        </h3>
        <button type="button" className="text-mizan-alerte hover:underline text-sm" onClick={async () => { await api.delete(`/cbam/processes/${p.id}`); onChange(); }}>Retirer</button>
      </div>
      <p className="text-xs text-mizan-gris">{p.installationName} · {String(p.periodStart).slice(0, 10)} → {String(p.periodEnd).slice(0, 10)} · production : {p.productionTonnes === null ? 'non renseignée' : `${num(p.productionTonnes, 3)} t`} · {CN_STATUS[p.cnCheck.status]}{p.cnCheck.category ? ` (${p.cnCheck.category})` : ''}</p>
      <p className={`text-sm ${p.status === 'calcule_valeurs_reelles' ? 'text-mizan-vert' : 'text-mizan-alerte'}`}>{STATUS[p.status]}</p>
      {p.unsupported.length > 0 && <ul className="text-xs text-mizan-alerte list-disc ml-5">{p.unsupported.map((u) => <li key={u}>{u}</li>)}</ul>}
      {p.missing.length > 0 && <ul className="text-xs text-mizan-alerte list-disc ml-5">{p.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
      {p.status !== 'non_pris_en_charge' && (
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div>Émissions directes attribuées : <span className="font-data">{num(p.attributedDirectTco2e)} tCO2e</span><br />Émissions spécifiques directes : <span className="font-data">{num(p.specificDirectEmissions)} tCO2e/t</span></div>
          <div>Émissions indirectes attribuées : <span className="font-data">{num(p.attributedIndirectTco2e)} tCO2e</span><br />Émissions spécifiques indirectes : <span className="font-data">{num(p.specificIndirectEmissions)} tCO2e/t</span></div>
        </div>
      )}
      <p className="text-xs text-mizan-gris">{p.indirectTreatmentNote} {p.defaultValuesNote}</p>
      {p.linkedEntries.length > 0 && (
        <ul className="text-xs divide-y divide-mizan-menthe">
          {p.linkedEntries.map((l) => (
            <li key={l.activityEntryId} className="py-1 flex justify-between">
              <span>Scope {l.scope} — {l.factorLabel ?? 'non calculé'} · {l.sharePct} % · {num(l.attributedTco2e)} tCO2e</span>
              <button type="button" className="text-mizan-alerte hover:underline" onClick={async () => { await api.delete(`/cbam/processes/${p.id}/entries/${l.activityEntryId}`); onChange(); }}>Retirer</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2 items-end">
        <select required className="input-field flex-1 min-w-[260px]" value={link.activityEntryId} onChange={(e) => setLink({ ...link, activityEntryId: e.target.value })}>
          <option value="">Rattacher une donnée (Scope 1 ou électricité)…</option>
          {eligible.map((e) => (
            <option key={e.id} value={e.id}>{e.site_name ?? '—'} · {String(e.period_start).slice(0, 10)} → {String(e.period_end).slice(0, 10)} · {e.factor_label} · {e.quantity}</option>
          ))}
        </select>
        <input type="number" min="0.01" max="100" step="any" className="input-field font-data w-28" value={link.sharePct} onChange={(e) => setLink({ ...link, sharePct: e.target.value })} title="Part attribuée (%)" />
        <button type="submit" className="btn-secondary">Rattacher</button>
      </form>
      {error && <p className="text-sm text-mizan-alerte">{error}</p>}
    </div>
  );
}

export function CbamProduction() {
  const [ref, setRef] = useState(null);
  const [data, setData] = useState(null);
  const [entries, setEntries] = useState([]);
  const [sites, setSites] = useState([]);
  const [inst, setInst] = useState({ name: '', siteId: '', address: '' });
  const [proc, setProc] = useState({ installationId: '', name: '', productName: '', cnCode: '', periodStart: '', periodEnd: '', productionTonnes: '', hasPrecursors: false, producesMultipleGoods: false, attributionNote: '' });
  const [cn, setCn] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    const [r, d, e, s] = await Promise.all([api.get('/cbam/reference'), api.get('/cbam/installations'), api.get('/activity-entries'), api.get('/companies/me/sites')]);
    setRef(r);
    setData(d);
    setEntries(e.entries);
    setSites(s.sites);
  };
  useEffect(() => { load(); }, []);
  if (!ref || !data) return null;

  const addInst = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/cbam/installations', { name: inst.name, siteId: inst.siteId ? Number(inst.siteId) : null, address: inst.address || undefined });
      setInst({ name: '', siteId: '', address: '' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.');
    }
  };
  const addProc = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/cbam/processes', {
        ...proc,
        installationId: Number(proc.installationId),
        productionTonnes: proc.productionTonnes === '' ? null : Number(proc.productionTonnes),
        attributionNote: proc.attributionNote || undefined,
      });
      setProc({ ...proc, name: '', productName: '', cnCode: '', productionTonnes: '', attributionNote: '' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        icon={IconFileCheck}
        title="CBAM — émissions intrinsèques par procédé"
        subtitle="Préparation des données par installation, période, produit, code douanier et procédé. Distinct du bilan organisationnel : seules les données explicitement rattachées à un procédé sont prises en compte."
      />
      <div className="card border-mizan-alerte/30 bg-mizan-alerte/5 space-y-2">
        <p className="text-sm text-mizan-alerte">
          Pris en charge : biens simples (sans précurseur), procédé mono-produit, valeurs réelles de l'installation.
          Non pris en charge : biens complexes avec précurseurs, procédés multi-produits, valeurs par défaut, chaleur
          mesurable et gaz résiduaires. Aucun export de ce module n'est un dépôt réglementaire ; le déclarant CBAM reste
          l'importateur européen et les émissions doivent être vérifiées par un vérificateur accrédité.
        </p>
        <p className="text-xs text-mizan-gris">
          Références vérifiées le {ref.checkedOn} ({ref.source}) :{' '}
          {ref.legalReferences.map((l) => `${l.act} — ${l.subject}`).join(' ; ')}.
        </p>
      </div>

      <div className="card space-y-2">
        <SectionHeader icon={IconFileCheck} title="Vérifier un code NC" />
        <div className="flex gap-2">
          <input className="input-field font-data max-w-xs" placeholder="ex. 72081000" onChange={async (e) => setCn(e.target.value.length >= 2 ? await api.get(`/cbam/cn-check?code=${encodeURIComponent(e.target.value)}`) : null)} />
        </div>
        {cn && <p className="text-sm">{CN_STATUS[cn.status]}{cn.category ? ` — ${cn.category}` : ''}. <span className="text-xs text-mizan-gris">{cn.note}</span></p>}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <form onSubmit={addInst} className="card space-y-3">
          <SectionHeader icon={IconBuilding} title="Installation" />
          <input required placeholder="Nom de l'installation" className="input-field" value={inst.name} onChange={(e) => setInst({ ...inst, name: e.target.value })} />
          <select className="input-field" value={inst.siteId} onChange={(e) => setInst({ ...inst, siteId: e.target.value })}>
            <option value="">Site associé (optionnel)</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input placeholder="Adresse" className="input-field" value={inst.address} onChange={(e) => setInst({ ...inst, address: e.target.value })} />
          <button type="submit" className="btn-primary">Ajouter</button>
          {data.installations.length > 0 && (
            <ul className="text-sm">{data.installations.map((i) => <li key={i.id}>{i.name} ({i.country})</li>)}</ul>
          )}
        </form>

        <form onSubmit={addProc} className="card space-y-3">
          <SectionHeader icon={IconFileCheck} title="Procédé de production" />
          <select required className="input-field" value={proc.installationId} onChange={(e) => setProc({ ...proc, installationId: e.target.value })}>
            <option value="">Installation…</option>
            {data.installations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input required placeholder="Procédé" className="input-field" value={proc.name} onChange={(e) => setProc({ ...proc, name: e.target.value })} />
            <input required placeholder="Produit" className="input-field" value={proc.productName} onChange={(e) => setProc({ ...proc, productName: e.target.value })} />
            <input required placeholder="Code NC (8 chiffres)" className="input-field font-data" value={proc.cnCode} onChange={(e) => setProc({ ...proc, cnCode: e.target.value })} />
            <input type="number" min="0" step="any" placeholder="Production (t)" className="input-field font-data" value={proc.productionTonnes} onChange={(e) => setProc({ ...proc, productionTonnes: e.target.value })} />
            <input required type="date" className="input-field font-data" value={proc.periodStart} onChange={(e) => setProc({ ...proc, periodStart: e.target.value })} />
            <input required type="date" className="input-field font-data" value={proc.periodEnd} onChange={(e) => setProc({ ...proc, periodEnd: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={proc.hasPrecursors} onChange={(e) => setProc({ ...proc, hasPrecursors: e.target.checked })} /> Utilise des précurseurs (bien complexe)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={proc.producesMultipleGoods} onChange={(e) => setProc({ ...proc, producesMultipleGoods: e.target.checked })} /> Produit plusieurs marchandises</label>
          <textarea placeholder="Règle d'attribution des émissions au procédé" className="input-field" rows={2} value={proc.attributionNote} onChange={(e) => setProc({ ...proc, attributionNote: e.target.value })} />
          <button type="submit" className="btn-primary">Ajouter</button>
        </form>
      </div>
      {error && <p className="text-sm text-mizan-alerte">{error}</p>}

      {data.processes.map((p) => <ProcessCard key={p.id} p={p} entries={entries} onChange={load} />)}
    </div>
  );
}
