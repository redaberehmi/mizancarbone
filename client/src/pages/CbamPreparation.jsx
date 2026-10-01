import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

function formatTco2e(value) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

function EntryProductInput({ entry, products, onSaved }) {
  const [value, setValue] = useState(entry.product ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed === (entry.product ?? '')) return;
    setSaving(true);
    try {
      await api.patch(`/activity-entries/${entry.id}/product-allocation`, {
        productAllocation: trimmed === '' ? null : trimmed,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      list="cbam-products"
      className="input-field py-1 text-sm"
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      placeholder="Non alloué"
    />
  );
}

export function CbamPreparation() {
  const [relevance, setRelevance] = useState(null);
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [relevanceRes, summaryRes, productsRes] = await Promise.all([
      api.get('/cbam-prep/relevance'),
      api.get('/cbam-prep/summary'),
      api.get('/cbam-prep/products'),
    ]);
    setRelevance(relevanceRes);
    setSummary(summaryRes);
    setProducts(productsRes.products);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  if (loading) return null;

  return (
    <div className="space-y-8 max-w-5xl">
      <datalist id="cbam-products">
        {products.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <div>
        <h1 className="font-display font-bold text-2xl text-mizan-ardoise">Préparation CBAM</h1>
        <p className="text-mizan-gris text-sm mt-1">
          Structuration de vos données par produit, réutilisable dans un questionnaire ou dossier destiné à
          un client européen.
        </p>
      </div>

      {!relevance.isCoveredSector && (
        <div className="card border-mizan-alerte/30 bg-mizan-alerte/5">
          <p className="text-sm text-mizan-alerte">
            Le CBAM couvre officiellement {relevance.officialCategories.join(', ').toLowerCase()}. Votre
            secteur n'est pas directement concerné, sauf activité spécifique relevant de l'une de ces
            catégories — ce module reste disponible en option secondaire.
          </p>
        </div>
      )}

      <div className="card border-mizan-alerte/30 bg-mizan-alerte/5">
        <p className="text-sm text-mizan-alerte">{summary.methodologyNote}</p>
      </div>

      <div className="card">
        <h2 className="font-display font-bold text-mizan-ardoise mb-1">Export</h2>
        <p className="text-sm text-mizan-gris mb-4">
          Fichiers de préparation de données, prêts à être transmis à votre client européen.
        </p>
        <div className="flex gap-3">
          <a href="/api/cbam-prep/export.csv" className="btn-secondary">Données de préparation CBAM (CSV)</a>
          <a href="/api/cbam-prep/export.pdf" className="btn-secondary">Données de préparation CBAM (PDF)</a>
        </div>
      </div>

      {summary.groups.length === 0 ? (
        <div className="card">
          <p className="text-sm text-mizan-gris">
            Aucune donnée disponible pour le moment. Saisissez des données dans le module Collecte de données.
          </p>
        </div>
      ) : (
        summary.groups.map((group) => (
          <div key={group.product ?? 'non-alloue'} className="card">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-display font-bold text-mizan-ardoise">{group.product ?? 'Non alloué'}</h2>
              <p className="text-sm text-mizan-gris font-data">
                {formatTco2e(group.energieTco2eTotal)} tCO2e (énergie) · {group.matierePremiereCount} ligne(s)
                matière première
              </p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="th-bi text-left text-mizan-gris border-b border-mizan-menthe">
                  <th className="py-2 pr-3">Site</th>
                  <th className="py-2 pr-3">Période</th>
                  <th className="py-2 pr-3">Nature</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3">Quantité</th>
                  <th className="py-2 pr-3">tCO2e</th>
                  <th className="py-2">Produit</th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((entry) => (
                  <tr key={entry.id} className="row-bi border-b border-mizan-menthe/60">
                    <td className="py-2 pr-3">{entry.siteName ?? '—'}</td>
                    <td className="py-2 pr-3 font-data">{entry.periodStart} → {entry.periodEnd}</td>
                    <td className="py-2 pr-3">
                      {entry.kind === 'energie' ? 'Énergie' : (
                        <span className="text-mizan-gris italic">Matière première</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{entry.description}</td>
                    <td className="py-2 pr-3 font-data">{entry.quantity}{entry.unit ? ` ${entry.unit}` : ''}</td>
                    <td className="py-2 pr-3 font-data">
                      {entry.kind === 'energie' ? (
                        entry.tco2e === null ? 'n.c.' : formatTco2e(entry.tco2e)
                      ) : (
                        <span className="text-mizan-gris italic">n.c.</span>
                      )}
                    </td>
                    <td className="py-2">
                      <EntryProductInput entry={entry} products={products} onSaved={loadAll} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
