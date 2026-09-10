import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';

const CATEGORY_LABELS = {
  combustion_fixe: 'Combustion fixe (chaudières, fours)',
  combustion_mobile: 'Combustion mobile (véhicules)',
  electricite_location_based: 'Électricité — location-based',
  electricite_market_based: 'Électricité — market-based',
};

const emptyEnergyForm = { siteId: '', periodStart: '', periodEnd: '', factorCode: '', quantity: '', sourceDocument: '' };
const emptyMaterialForm = { siteId: '', periodStart: '', periodEnd: '', materialLabel: '', quantity: '', supplier: '', sourceDocument: '' };

export function DataCollection() {
  const [sites, setSites] = useState(null);
  const [factors, setFactors] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const [energyForm, setEnergyForm] = useState(emptyEnergyForm);
  const [materialForm, setMaterialForm] = useState(emptyMaterialForm);
  const [energyError, setEnergyError] = useState(null);
  const [materialError, setMaterialError] = useState(null);

  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importErrors, setImportErrors] = useState(null);
  const [importing, setImporting] = useState(false);

  const factorByCode = useMemo(() => new Map(factors.map((f) => [f.code, f])), [factors]);
  const groupedFactors = useMemo(() => {
    const groups = new Map();
    for (const f of factors) {
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
      });
      setEnergyForm(emptyEnergyForm);
      await loadAll();
    } catch (err) {
      setEnergyError(err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement.');
    }
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
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="font-display font-bold text-2xl text-mizan-ardoise">Collecte de données</h1>
        <p className="text-mizan-gris text-sm mt-1">
          Saisie manuelle ou import CSV/Excel — organisée par site et par période.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <form onSubmit={handleEnergySubmit} className="card space-y-3">
          <h2 className="font-display font-bold text-mizan-ardoise">Électricité, carburant, gaz</h2>

          <div>
            <label className="label-field">Site</label>
            <select
              required
              className="input-field"
              value={energyForm.siteId}
              onChange={(e) => setEnergyForm({ ...energyForm, siteId: e.target.value })}
            >
              <option value="" disabled>Choisir…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-field">Début de période</label>
              <input type="date" required className="input-field font-data" value={energyForm.periodStart} onChange={(e) => setEnergyForm({ ...energyForm, periodStart: e.target.value })} />
            </div>
            <div>
              <label className="label-field">Fin de période</label>
              <input type="date" required className="input-field font-data" value={energyForm.periodEnd} onChange={(e) => setEnergyForm({ ...energyForm, periodEnd: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label-field">Type / facteur</label>
            <select
              required
              className="input-field"
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
            </select>
          </div>

          <div>
            <label className="label-field">
              Quantité {energyForm.factorCode && factorByCode.get(energyForm.factorCode) && `(${factorByCode.get(energyForm.factorCode).unit})`}
            </label>
            <input type="number" step="any" min="0" required className="input-field font-data" value={energyForm.quantity} onChange={(e) => setEnergyForm({ ...energyForm, quantity: e.target.value })} />
          </div>

          <div>
            <label className="label-field">Document source (optionnel)</label>
            <input className="input-field" value={energyForm.sourceDocument} onChange={(e) => setEnergyForm({ ...energyForm, sourceDocument: e.target.value })} />
          </div>

          {energyError && <p className="text-sm text-mizan-alerte">{energyError}</p>}
          <button type="submit" className="btn-primary w-full">Enregistrer</button>
        </form>

        <form onSubmit={handleMaterialSubmit} className="card space-y-3">
          <h2 className="font-display font-bold text-mizan-ardoise">Matières premières</h2>
          <p className="text-xs text-mizan-gris -mt-2">
            Donnée de traçabilité (utile pour la préparation CBAM) — pas encore intégrée au calcul
            d'émissions, qui utilisera un ratio sectoriel global.
          </p>

          <div>
            <label className="label-field">Site</label>
            <select
              required
              className="input-field"
              value={materialForm.siteId}
              onChange={(e) => setMaterialForm({ ...materialForm, siteId: e.target.value })}
            >
              <option value="" disabled>Choisir…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-field">Début de période</label>
              <input type="date" required className="input-field font-data" value={materialForm.periodStart} onChange={(e) => setMaterialForm({ ...materialForm, periodStart: e.target.value })} />
            </div>
            <div>
              <label className="label-field">Fin de période</label>
              <input type="date" required className="input-field font-data" value={materialForm.periodEnd} onChange={(e) => setMaterialForm({ ...materialForm, periodEnd: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label-field">Matière (précisez l'unité, ex : "Bobines acier — tonnes")</label>
            <input required className="input-field" value={materialForm.materialLabel} onChange={(e) => setMaterialForm({ ...materialForm, materialLabel: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
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

      <div className="card">
        <h2 className="font-display font-bold text-mizan-ardoise mb-1">Import CSV / Excel</h2>
        <p className="text-sm text-mizan-gris mb-4">
          Colonnes attendues : site, type (energie/matiere_premiere), code_facteur, description_matiere,
          fournisseur, periode_debut, periode_fin, quantite, document_source.{' '}
          <a href="/api/activity-entries/import/template" className="text-mizan-vert font-medium">
            Télécharger le modèle
          </a>
        </p>
        <form onSubmit={handleImport} className="flex items-center gap-3">
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
        <h2 className="font-display font-bold text-mizan-ardoise mb-4">Entrées enregistrées</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-mizan-gris">Aucune donnée saisie pour le moment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-mizan-gris border-b border-mizan-menthe/60">
                  <th className="py-2 pr-3">Site</th>
                  <th className="py-2 pr-3">Période</th>
                  <th className="py-2 pr-3">Nature</th>
                  <th className="py-2 pr-3">Quantité</th>
                  <th className="py-2 pr-3">Fournisseur</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const factor = factorByCode.get(entry.factor_code);
                  const isRawMaterial = entry.material_label !== null;
                  return (
                    <tr key={entry.id} className="border-b border-mizan-menthe/30">
                      <td className="py-2 pr-3">{entry.site_name ?? '—'}</td>
                      <td className="py-2 pr-3 font-data">{entry.period_start} → {entry.period_end}</td>
                      <td className="py-2 pr-3">
                        {isRawMaterial ? entry.material_label : factor?.label ?? entry.factor_code}
                        {!isRawMaterial && factor && !factor.is_national && (
                          <span className="badge-non-national ml-2">générique</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-data">
                        {entry.quantity}{!isRawMaterial && factor ? ` ${factor.unit}` : ''}
                      </td>
                      <td className="py-2 pr-3">{entry.supplier ?? '—'}</td>
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
