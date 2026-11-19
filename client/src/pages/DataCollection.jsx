import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { IconInput, IconSelect } from '../components/FormField.jsx';
import { IconDatabase, IconMapPin, IconCalendar, IconLeaf, IconFileCheck } from '../components/icons.jsx';

const CATEGORY_LABELS = {
  combustion_fixe: 'Scope 1 — combustion fixe (chaudières, fours)',
  combustion_mobile: 'Scope 1 — combustion mobile (véhicules, engins)',
  procede: 'Scope 1 — émissions de procédés',
  fugitive: 'Scope 1 — fluides frigorigènes (masse rechargée = fuite)',
  electricite_location_based: 'Scope 2 — électricité achetée (consommation totale)',
  scope3_achat_physique: 'Scope 3 — achats en quantité physique',
  scope3_achat_monetaire: 'Scope 3 — achats par ratio monétaire (kMAD)',
  scope3_immobilisation: "Scope 3 — biens d'équipement",
  scope3_dechets: 'Scope 3 — déchets',
  scope3_fret: 'Scope 3 — fret',
  scope3_pertes_reseau: 'Scope 3 — pertes en ligne du réseau électrique',
};

const SCOPE3_CATEGORY_CHOICES = {
  scope3_achat_physique: [1, 2],
  scope3_achat_monetaire: [1, 2],
  scope3_fret: [4, 9],
};
const SCOPE3_CATEGORY_LABELS = { 1: '1 — Achats de biens et services', 2: "2 — Biens d'équipement", 4: '4 — Transport amont (payé par l’entreprise)', 9: '9 — Transport aval' };
const CONTROL_LABELS = { non_controle: 'Non contrôlé', controle_interne_effectue: 'Contrôle interne effectué', anomalie_signalee: 'Anomalie signalée' };

function FactorHint({ factor }) {
  if (!factor) return null;
  return (
    <p className="text-xs text-mizan-gris leading-relaxed">
      {factor.value_kgco2e} kgCO2e/{factor.unit}
      {factor.represented_year ? ` · année représentée : ${factor.represented_year}` : ''}
      {factor.uncertainty_pct !== null && factor.uncertainty_pct !== undefined ? ` · incertitude ± ${factor.uncertainty_pct} %` : ''}
      {factor.rights_status === 'a_confirmer' ? ' · droits de réutilisation à confirmer' : ''}
      {factor.usage_restrictions ? <><br />{factor.usage_restrictions}</> : null}
    </p>
  );
}

const emptyEnergyForm = { siteId: '', periodStart: '', periodEnd: '', factorCode: '', quantity: '', sourceDocument: '', dataOrigin: '' };
const emptyScope3Form = { siteId: '', periodStart: '', periodEnd: '', factorCode: '', quantity: '', amountMad: '', massTonnes: '', distanceKm: '', scope3Category: '', factorJustification: '', description: '', sourceDocument: '', dataOrigin: '' };
const emptyMaterialForm = { siteId: '', periodStart: '', periodEnd: '', materialLabel: '', quantity: '', supplier: '', sourceDocument: '' };

export function DataCollection() {
  const [sites, setSites] = useState(null);
  const [factors, setFactors] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const [energyForm, setEnergyForm] = useState(emptyEnergyForm);
  const [materialForm, setMaterialForm] = useState(emptyMaterialForm);
  const [energyError, setEnergyError] = useState(null);
  const [scope3Form, setScope3Form] = useState(emptyScope3Form);
  const [scope3Error, setScope3Error] = useState(null);
  const [materialError, setMaterialError] = useState(null);

  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importErrors, setImportErrors] = useState(null);
  const [importing, setImporting] = useState(false);

  const factorByCode = useMemo(() => new Map(factors.map((f) => [f.code, f])), [factors]);
  const groupedFactors = useMemo(() => {
    const groups = new Map();
    for (const f of factors.filter((x) => x.scope !== 3)) {
      if (!groups.has(f.category)) groups.set(f.category, []);
      groups.get(f.category).push(f);
    }
    return groups;
  }, [factors]);
  const groupedScope3Factors = useMemo(() => {
    const groups = new Map();
    for (const f of factors.filter((x) => x.scope === 3)) {
      if (!groups.has(f.category)) groups.set(f.category, []);
      groups.get(f.category).push(f);
    }
    return groups;
  }, [factors]);

  async function loadAll() {
    setLoading(true);
    const [sitesRes, factorsRes, entriesRes] = await Promise.all([
      api.get('/companies/me/sites'),
      api.get('/activity-entries/factors'),
      api.get('/activity-entries'),
    ]);
    setSites(sitesRes.sites);
    setFactors(factorsRes.factors);
    setEntries(entriesRes.entries);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  if (loading) return null;

  if (sites.length === 0) {
    return (
      <div className="card max-w-xl">
        <h1 className="font-display font-bold text-lg text-mizan-ardoise mb-2">Collecte de données</h1>
        <p className="text-mizan-gris mb-4">
          Vous devez d'abord ajouter au moins un site de production avant de pouvoir saisir des données
          d'activité.
        </p>
        <Link to="/entreprise" className="btn-primary inline-block">Ajouter un site</Link>
      </div>
    );
  }

  const handleEnergySubmit = async (e) => {
    e.preventDefault();
    setEnergyError(null);
    try {
      await api.post('/activity-entries/energie', {
        siteId: Number(energyForm.siteId),
        periodStart: energyForm.periodStart,
        periodEnd: energyForm.periodEnd,
        factorCode: energyForm.factorCode,
        quantity: Number(energyForm.quantity),
        sourceDocument: energyForm.sourceDocument || undefined,
        dataOrigin: energyForm.dataOrigin || undefined,
      });
      setEnergyForm(emptyEnergyForm);
      await loadAll();
    } catch (err) {
      setEnergyError(err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement.');
    }
  };

  const scope3Factor = factorByCode.get(scope3Form.factorCode);
  const scope3Unit = String(scope3Factor?.unit ?? '').toLowerCase();
  const handleScope3Submit = async (e) => {
    e.preventDefault();
    setScope3Error(null);
    const num = (v) => (v === '' ? undefined : Number(v));
    try {
      await api.post('/activity-entries/energie', {
        siteId: scope3Form.siteId ? Number(scope3Form.siteId) : null,
        periodStart: scope3Form.periodStart,
        periodEnd: scope3Form.periodEnd,
        factorCode: scope3Form.factorCode,
        quantity: scope3Unit === 'kmad' || scope3Unit === 'tonne.km' ? undefined : num(scope3Form.quantity),
        amountMad: scope3Unit === 'kmad' ? num(scope3Form.amountMad) : undefined,
        massTonnes: scope3Unit === 'tonne.km' ? num(scope3Form.massTonnes) : undefined,
        distanceKm: scope3Unit === 'tonne.km' ? num(scope3Form.distanceKm) : undefined,
        scope3Category: num(scope3Form.scope3Category),
        factorJustification: scope3Form.factorJustification || undefined,
        description: scope3Form.description || undefined,
        sourceDocument: scope3Form.sourceDocument || undefined,
        dataOrigin: scope3Form.dataOrigin || undefined,
      });
      setScope3Form(emptyScope3Form);
      await loadAll();
    } catch (err) {
      setScope3Error(err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement.');
    }
  };

  const handleControl = async (entry, status) => {
    let note;
    if (status === 'anomalie_signalee') {
      note = window.prompt("Décrivez l'anomalie constatée :") ?? '';
      if (!note.trim()) return;
    }
    await api.patch(`/methodology/entries/${entry.id}/internal-control`, { status, note });
    await loadAll();
  };

  const handleMaterialSubmit = async (e) => {
    e.preventDefault();
    setMaterialError(null);
    try {
      await api.post('/activity-entries/matieres-premieres', {
        siteId: Number(materialForm.siteId),
        periodStart: materialForm.periodStart,
        periodEnd: materialForm.periodEnd,
        materialLabel: materialForm.materialLabel,
        quantity: Number(materialForm.quantity),
        supplier: materialForm.supplier || undefined,
        sourceDocument: materialForm.sourceDocument || undefined,
      });
      setMaterialForm(emptyMaterialForm);
      await loadAll();
    } catch (err) {
      setMaterialError(err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement.');
    }
  };

  const handleDelete = async (id) => {
    await api.delete(`/activity-entries/${id}`);
    setEntries(entries.filter((e) => e.id !== id));
  };

  const handleImport = async (e) => {
    e.preventDefault();
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    setImportErrors(null);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const data = await api.postForm('/activity-entries/import', formData);
      setImportResult(data.imported);
      setImportFile(null);
      await loadAll();
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setImportErrors(err.details);
      } else if (err instanceof ApiError) {
        setImportErrors([{ line: 0, field: 'fichier', message: err.message }]);
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        icon={IconDatabase}
        title="Collecte de données"
        subtitle="Saisie manuelle ou import CSV/Excel — organisée par site et par période. Chaque donnée est calculée avec un facteur sourcé et versionné."
      />

      <div className="grid md:grid-cols-2 gap-6">
        <form onSubmit={handleEnergySubmit} className="card space-y-3">
          <SectionHeader icon={IconDatabase} title="Scope 1 et 2 — combustibles, procédés, fluides, électricité" />

          <div>
            <label className="label-field">Site</label>
            <IconSelect
              icon={IconMapPin}
              required
              value={energyForm.siteId}
              onChange={(e) => setEnergyForm({ ...energyForm, siteId: e.target.value })}
            >
              <option value="" disabled>Choisir…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </IconSelect>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label-field">Début de période</label>
              <IconInput icon={IconCalendar} type="date" required className="font-data" value={energyForm.periodStart} onChange={(e) => setEnergyForm({ ...energyForm, periodStart: e.target.value })} />
            </div>
            <div>
              <label className="label-field">Fin de période</label>
              <IconInput icon={IconCalendar} type="date" required className="font-data" value={energyForm.periodEnd} onChange={(e) => setEnergyForm({ ...energyForm, periodEnd: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label-field">Type / facteur</label>
            <IconSelect
              icon={IconDatabase}
              required
              value={energyForm.factorCode}
              onChange={(e) => setEnergyForm({ ...energyForm, factorCode: e.target.value })}
            >
              <option value="" disabled>Choisir…</option>
              {[...groupedFactors.entries()].map(([category, list]) => (
                <optgroup key={category} label={CATEGORY_LABELS[category] || category}>
                  {list.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.label} ({f.unit}){!f.is_national ? ' — facteur générique, à remplacer' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </IconSelect>
          </div>

          <div>
            <label className="label-field">
              Quantité {energyForm.factorCode && factorByCode.get(energyForm.factorCode) && `(${factorByCode.get(energyForm.factorCode).unit})`}
            </label>
            <input type="number" step="any" min="0" required className="input-field font-data" value={energyForm.quantity} onChange={(e) => setEnergyForm({ ...energyForm, quantity: e.target.value })} />
          </div>
          <FactorHint factor={factorByCode.get(energyForm.factorCode)} />

          <div>
            <label className="label-field">Origine de la donnée</label>
            <select className="input-field" value={energyForm.dataOrigin} onChange={(e) => setEnergyForm({ ...energyForm, dataOrigin: e.target.value })}>
              <option value="">Non précisée</option>
              <option value="mesuree">Mesurée (facture, compteur)</option>
              <option value="estimee">Estimée</option>
            </select>
          </div>

          <div>
            <label className="label-field">Document source (optionnel)</label>
            <input className="input-field" value={energyForm.sourceDocument} onChange={(e) => setEnergyForm({ ...energyForm, sourceDocument: e.target.value })} />
          </div>

          {energyError && <p className="text-sm text-mizan-alerte">{energyError}</p>}
          <button type="submit" className="btn-primary w-full">Enregistrer</button>
        </form>

        <form onSubmit={handleMaterialSubmit} className="card space-y-3">
          <SectionHeader icon={IconLeaf} title="Matières premières" />
          <p className="text-xs text-mizan-gris -mt-2">
            Donnée de traçabilité (utile pour la préparation CBAM) : aucune émission n'est calculée ici.
            Pour comptabiliser l'achat en Scope 3, saisissez-le aussi dans le formulaire Scope 3 avec un
            facteur adapté.
          </p>

          <div>
            <label className="label-field">Site</label>
            <IconSelect
              icon={IconMapPin}
              required
              value={materialForm.siteId}
              onChange={(e) => setMaterialForm({ ...materialForm, siteId: e.target.value })}
            >
              <option value="" disabled>Choisir…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </IconSelect>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label-field">Début de période</label>
              <IconInput icon={IconCalendar} type="date" required className="font-data" value={materialForm.periodStart} onChange={(e) => setMaterialForm({ ...materialForm, periodStart: e.target.value })} />
            </div>
            <div>
              <label className="label-field">Fin de période</label>
              <IconInput icon={IconCalendar} type="date" required className="font-data" value={materialForm.periodEnd} onChange={(e) => setMaterialForm({ ...materialForm, periodEnd: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label-field">Matière (précisez l'unité, ex : "Bobines acier — tonnes")</label>
            <input required className="input-field" value={materialForm.materialLabel} onChange={(e) => setMaterialForm({ ...materialForm, materialLabel: e.target.value })} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label-field">Quantité</label>
              <input type="number" step="any" min="0" required className="input-field font-data" value={materialForm.quantity} onChange={(e) => setMaterialForm({ ...materialForm, quantity: e.target.value })} />
            </div>
            <div>
              <label className="label-field">Fournisseur (optionnel)</label>
              <input className="input-field" value={materialForm.supplier} onChange={(e) => setMaterialForm({ ...materialForm, supplier: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label-field">Document source (optionnel)</label>
            <input className="input-field" value={materialForm.sourceDocument} onChange={(e) => setMaterialForm({ ...materialForm, sourceDocument: e.target.value })} />
          </div>

          {materialError && <p className="text-sm text-mizan-alerte">{materialError}</p>}
          <button type="submit" className="btn-primary w-full">Enregistrer</button>
        </form>
      </div>

      <form onSubmit={handleScope3Submit} className="card space-y-3">
        <SectionHeader icon={IconLeaf} title="Scope 3 — achats, immobilisations, fret, déchets, pertes réseau" />
        <p className="text-xs text-mizan-gris -mt-2">
          Une ligne par catégorie d'achat ou de flux, avec un facteur choisi pour cette catégorie. Un ratio monétaire
          (kgCO2e/kMAD) est une estimation : émissions = montant en MAD / 1000 × facteur, sans conversion de devise,
          et son choix doit être justifié.
        </p>
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="label-field">Site (optionnel)</label>
            <IconSelect icon={IconMapPin} value={scope3Form.siteId} onChange={(e) => setScope3Form({ ...scope3Form, siteId: e.target.value })}>
              <option value="">Toute l'entreprise</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </IconSelect>
          </div>
          <div>
            <label className="label-field">Début de période</label>
            <IconInput icon={IconCalendar} type="date" required className="font-data" value={scope3Form.periodStart} onChange={(e) => setScope3Form({ ...scope3Form, periodStart: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Fin de période</label>
            <IconInput icon={IconCalendar} type="date" required className="font-data" value={scope3Form.periodEnd} onChange={(e) => setScope3Form({ ...scope3Form, periodEnd: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label-field">Facteur</label>
          <IconSelect icon={IconDatabase} required value={scope3Form.factorCode} onChange={(e) => setScope3Form({ ...scope3Form, factorCode: e.target.value, scope3Category: '' })}>
            <option value="" disabled>{groupedScope3Factors.size === 0 ? 'Aucun facteur Scope 3 disponible dans le registre' : 'Choisir…'}</option>
            {[...groupedScope3Factors.entries()].map(([category, list]) => (
              <optgroup key={category} label={CATEGORY_LABELS[category] || category}>
                {list.map((f) => <option key={f.code} value={f.code}>{f.label} ({f.unit})</option>)}
              </optgroup>
            ))}
          </IconSelect>
        </div>
        <FactorHint factor={scope3Factor} />
        <div className="grid md:grid-cols-3 gap-3">
          {scope3Unit === 'kmad' && (
            <div>
              <label className="label-field">Montant HT (MAD)</label>
              <input type="number" step="any" min="0" required className="input-field font-data" value={scope3Form.amountMad} onChange={(e) => setScope3Form({ ...scope3Form, amountMad: e.target.value })} />
            </div>
          )}
          {scope3Unit === 'tonne.km' && (
            <>
              <div>
                <label className="label-field">Masse transportée (t)</label>
                <input type="number" step="any" min="0" required className="input-field font-data" value={scope3Form.massTonnes} onChange={(e) => setScope3Form({ ...scope3Form, massTonnes: e.target.value })} />
              </div>
              <div>
                <label className="label-field">Distance (km)</label>
                <input type="number" step="any" min="0" required className="input-field font-data" value={scope3Form.distanceKm} onChange={(e) => setScope3Form({ ...scope3Form, distanceKm: e.target.value })} />
              </div>
            </>
          )}
          {scope3Factor && scope3Unit !== 'kmad' && scope3Unit !== 'tonne.km' && (
            <div>
              <label className="label-field">Quantité ({scope3Factor.unit})</label>
              <input type="number" step="any" min="0" required className="input-field font-data" value={scope3Form.quantity} onChange={(e) => setScope3Form({ ...scope3Form, quantity: e.target.value })} />
            </div>
          )}
          {scope3Factor && SCOPE3_CATEGORY_CHOICES[scope3Factor.category] && (
            <div>
              <label className="label-field">Catégorie Scope 3</label>
              <select className="input-field" required={scope3Factor.category === 'scope3_fret'} value={scope3Form.scope3Category} onChange={(e) => setScope3Form({ ...scope3Form, scope3Category: e.target.value })}>
                <option value="">{scope3Factor.category === 'scope3_fret' ? 'Choisir…' : 'Par défaut'}</option>
                {SCOPE3_CATEGORY_CHOICES[scope3Factor.category].map((c) => <option key={c} value={c}>{SCOPE3_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
          )}
        </div>
        {scope3Unit === 'kmad' && (
          <div>
            <label className="label-field">Justification du choix de ce ratio pour cette catégorie d'achat</label>
            <textarea required minLength={10} className="input-field" rows={2} value={scope3Form.factorJustification} onChange={(e) => setScope3Form({ ...scope3Form, factorJustification: e.target.value })} />
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="label-field">Description (optionnel)</label>
            <input className="input-field" value={scope3Form.description} onChange={(e) => setScope3Form({ ...scope3Form, description: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Document source (optionnel)</label>
            <input className="input-field" value={scope3Form.sourceDocument} onChange={(e) => setScope3Form({ ...scope3Form, sourceDocument: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Origine de la donnée</label>
            <select className="input-field" value={scope3Form.dataOrigin} onChange={(e) => setScope3Form({ ...scope3Form, dataOrigin: e.target.value })}>
              <option value="">Non précisée</option>
              <option value="mesuree">Mesurée</option>
              <option value="estimee">Estimée</option>
            </select>
          </div>
        </div>
        {scope3Error && <p className="text-sm text-mizan-alerte">{scope3Error}</p>}
        <button type="submit" className="btn-primary">Enregistrer</button>
      </form>

      <div className="card">
        <SectionHeader icon={IconFileCheck} title="Import CSV / Excel" />
        <p className="text-sm text-mizan-gris mb-4">
          Colonnes attendues : site, type (energie/matiere_premiere), code_facteur, description_matiere,
          fournisseur, periode_debut, periode_fin, quantite, document_source. L'import couvre les données
          Scope 1 et 2 ; le Scope 3 se saisit dans le formulaire dédié.{' '}
          <a href="/api/activity-entries/import/template" className="text-mizan-vert font-medium">
            Télécharger le modèle
          </a>
        </p>
        <form onSubmit={handleImport} className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button type="submit" disabled={!importFile || importing} className="btn-secondary">
            {importing ? 'Import…' : 'Importer'}
          </button>
        </form>

        {importResult !== null && (
          <p className="text-sm text-mizan-vert mt-3">{importResult} ligne(s) importée(s) avec succès.</p>
        )}

        {importErrors && (
          <div className="mt-3 rounded-lg border border-mizan-alerte/30 bg-mizan-alerte/5 p-3">
            <p className="text-sm text-mizan-alerte font-medium mb-2">
              Aucune donnée importée — corrigez les lignes suivantes puis réessayez :
            </p>
            <ul className="text-sm text-mizan-alerte space-y-1 font-data">
              {importErrors.map((err, i) => (
                <li key={i}>
                  {err.line > 0 ? `Ligne ${err.line}` : 'Fichier'} · {err.field} : {err.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card">
        <SectionHeader icon={IconDatabase} title="Entrées enregistrées" />
        {entries.length === 0 ? (
          <p className="text-sm text-mizan-gris">Aucune donnée saisie pour le moment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
                  <th className="py-2 pr-3">Site</th>
                  <th className="py-2 pr-3">Période</th>
                  <th className="py-2 pr-3">Nature</th>
                  <th className="py-2 pr-3">Quantité</th>
                  <th className="py-2 pr-3">tCO2e</th>
                  <th className="py-2 pr-3">Contrôle interne</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const factor = factorByCode.get(entry.factor_code);
                  const isRawMaterial = entry.material_label !== null;
                  return (
                    <tr key={entry.id} className="row-bi border-b border-mizan-menthe/60">
                      <td className="py-2 pr-3">{entry.site_name ?? '—'}</td>
                      <td className="py-2 pr-3 font-data">{entry.period_start} → {entry.period_end}</td>
                      <td className="py-2 pr-3">
                        {isRawMaterial ? entry.material_label : entry.factor_label ?? factor?.label ?? entry.factor_code}
                        {!isRawMaterial && factor && !factor.is_national && (
                          <span className="badge-non-national ml-2">générique</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-data">
                        {entry.quantity}{!isRawMaterial ? ` ${entry.factor_unit ?? factor?.unit ?? ''}` : ''}
                        {entry.amount_mad ? <span className="text-mizan-gris"> ({Number(entry.amount_mad).toLocaleString('fr-FR')} MAD)</span> : null}
                      </td>
                      <td className="py-2 pr-3 font-data">
                        {isRawMaterial ? <span className="text-mizan-gris italic">traçabilité</span> : entry.tco2e === null ? <span className="text-mizan-gris italic">Non calculé</span> : Number(entry.tco2e).toLocaleString('fr-FR', { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-2 pr-3">
                        {isRawMaterial ? '—' : (
                          <select
                            className="input-field py-1 text-xs"
                            value={entry.internal_control_status}
                            onChange={(e) => handleControl(entry, e.target.value)}
                            title={entry.internal_control_note ?? ''}
                          >
                            {Object.entries(CONTROL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <button onClick={() => handleDelete(entry.id)} className="text-mizan-alerte hover:underline">
                          Retirer
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
