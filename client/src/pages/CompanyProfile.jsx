import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, ApiError } from '../api/client.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { IconInput, IconSelect } from '../components/FormField.jsx';
import {
  IconBuilding, IconUsers, IconCalendar, IconCoins, IconLeaf,
  IconSave, IconMapPin, IconTrash, IconPlus,
} from '../components/icons.jsx';

// Doit rester synchronisé avec SECTORS côté serveur (server/src/modules/auth/auth.validation.js).
// Les 6 derniers sont les catégories officiellement couvertes par le règlement CBAM.
const SECTORS = [
  { value: 'automobile', label: 'Automobile' },
  { value: 'textile', label: 'Textile' },
  { value: 'agroalimentaire', label: 'Agroalimentaire' },
  { value: 'metallurgie', label: 'Métallurgie' },
  { value: 'fer_et_acier', label: 'Fer et acier (CBAM)' },
  { value: 'aluminium', label: 'Aluminium (CBAM)' },
  { value: 'ciment', label: 'Ciment (CBAM)' },
  { value: 'engrais', label: 'Engrais (CBAM)' },
  { value: 'electricite', label: 'Électricité (CBAM)' },
  { value: 'hydrogene', label: 'Hydrogène (CBAM)' },
];

export function CompanyProfile() {
  const { company, setCompany } = useAuth();
  const [form, setForm] = useState(null);
  const [baseYearReason, setBaseYearReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const [sites, setSites] = useState([]);
  const [newSite, setNewSite] = useState({ name: '', city: '' });
  const [sitesError, setSitesError] = useState(null);

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name,
        sector: company.sector,
        headcount: company.headcount ?? '',
        baseYear: company.baseYear ?? '',
        annualRevenueMad: company.annualRevenueMad ?? '',
        reportingFrequency: company.reportingFrequency ?? '',
        declaredSizeCategory: company.declaredSizeCategory ?? '',
      });
    }
  }, [company]);

  useEffect(() => {
    loadSites();
  }, []);

  async function loadSites() {
    try {
      const data = await api.get('/companies/me/sites');
      setSites(data.sites);
    } catch {
      // silencieux : la liste des sites n'est pas critique à l'affichage initial
    }
  }

  if (!form) return null;

  const baseYearChanged =
    company.baseYear !== null &&
    company.baseYear !== undefined &&
    form.baseYear !== '' &&
    Number(form.baseYear) !== company.baseYear;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (baseYearChanged && baseYearReason.trim().length < 5) {
      setError("Une raison (au moins quelques mots) est obligatoire pour changer l'année de référence déjà établie.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name,
        sector: form.sector,
        headcount: form.headcount === '' ? null : Number(form.headcount),
        baseYear: form.baseYear === '' ? null : Number(form.baseYear),
        annualRevenueMad: form.annualRevenueMad === '' ? null : Number(form.annualRevenueMad),
        reportingFrequency: form.reportingFrequency === '' ? null : form.reportingFrequency,
        declaredSizeCategory: form.declaredSizeCategory === '' ? null : form.declaredSizeCategory,
        ...(baseYearChanged ? { baseYearChangeReason: baseYearReason.trim() } : {}),
      };
      const data = await api.put('/companies/me', payload);
      setCompany(data.company);
      setBaseYearReason('');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la mise à jour.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSite = async (e) => {
    e.preventDefault();
    setSitesError(null);
    try {
      const data = await api.post('/companies/me/sites', newSite);
      setSites([...sites, data.site]);
      setNewSite({ name: '', city: '' });
    } catch (err) {
      setSitesError(err instanceof ApiError ? err.message : "Erreur lors de l'ajout du site.");
    }
  };

  const handleDeleteSite = async (siteId) => {
    await api.delete(`/companies/me/sites/${siteId}`);
    setSites(sites.filter((s) => s.id !== siteId));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        icon={IconBuilding}
        title="Profil entreprise"
        subtitle="Ces informations servent de socle pour tous vos calculs et rapports."
      />

      <form onSubmit={handleSubmit} className="card space-y-6">
        <div>
          <SectionHeader icon={IconBuilding} title="Informations générales" />
          <div className="space-y-4">
            <div>
              <label className="label-field" htmlFor="name">Nom de l'entreprise</label>
              <IconInput
                id="name"
                icon={IconBuilding}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label-field" htmlFor="sector">Secteur d'activité</label>
                <IconSelect
                  id="sector"
                  icon={IconBuilding}
                  value={form.sector}
                  onChange={(e) => setForm({ ...form, sector: e.target.value })}
                >
                  {SECTORS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </IconSelect>
              </div>
              <div>
                <label className="label-field" htmlFor="headcount">Effectif</label>
                <IconInput
                  id="headcount"
                  icon={IconUsers}
                  type="number"
                  min="1"
                  className="font-data"
                  value={form.headcount}
                  onChange={(e) => setForm({ ...form, headcount: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label-field" htmlFor="baseYear">
                Année de référence (base year GHG Protocol)
              </label>
              <IconInput
                id="baseYear"
                icon={IconCalendar}
                type="number"
                className="font-data max-w-[200px]"
                value={form.baseYear}
                onChange={(e) => setForm({ ...form, baseYear: e.target.value })}
              />
              {baseYearChanged && (
                <div className="mt-3 rounded-lg border border-mizan-alerte/30 bg-mizan-alerte/5 p-3">
                  <label className="label-field text-mizan-alerte" htmlFor="baseYearReason">
                    Raison obligatoire du changement (ex : cession de site, changement de méthodologie Scope 3)
                  </label>
                  <textarea
                    id="baseYearReason"
                    className="input-field"
                    rows={2}
                    value={baseYearReason}
                    onChange={(e) => setBaseYearReason(e.target.value)}
                  />
                  <p className="text-xs text-mizan-gris mt-1">
                    Ce changement sera historisé et restera consultable pour justifier l'évolution de vos émissions dans le temps.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-mizan-menthe pt-6">
          <SectionHeader icon={IconCoins} title="Données financières" />
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label-field" htmlFor="annualRevenueMad">
                Chiffre d'affaires annuel (MAD)
              </label>
              <IconInput
                id="annualRevenueMad"
                icon={IconCoins}
                type="number"
                min="0"
                step="0.01"
                className="font-data"
                value={form.annualRevenueMad}
                onChange={(e) => setForm({ ...form, annualRevenueMad: e.target.value })}
              />
              <p className="text-xs text-mizan-gris mt-1">Optionnel — sert uniquement à calculer l'intensité carbone au tableau de bord.</p>
            </div>
            <div>
              <label className="label-field" htmlFor="reportingFrequency">
                Fréquence de reporting
              </label>
              <IconSelect
                id="reportingFrequency"
                icon={IconCalendar}
                value={form.reportingFrequency}
                onChange={(e) => setForm({ ...form, reportingFrequency: e.target.value })}
              >
                <option value="">Non renseignée</option>
                <option value="mensuelle">Mensuelle</option>
                <option value="trimestrielle">Trimestrielle</option>
                <option value="annuelle">Annuelle</option>
              </IconSelect>
              <p className="text-xs text-mizan-gris mt-1">Sert à détecter les données manquantes et la complétude au tableau de bord.</p>
            </div>
          </div>
        </div>

        <div className="border-t border-mizan-menthe pt-6">
          <SectionHeader icon={IconLeaf} title="Taille de l'entreprise" />
          <label className="label-field" htmlFor="declaredSizeCategory">
            Taille d'entreprise (si CA non renseigné)
          </label>
          <IconSelect
            id="declaredSizeCategory"
            icon={IconBuilding}
            className="max-w-[320px]"
            value={form.declaredSizeCategory}
            onChange={(e) => setForm({ ...form, declaredSizeCategory: e.target.value })}
          >
            <option value="">Non renseignée</option>
            <option value="tpe">TPE (moins de 10 salariés)</option>
            <option value="pme">PME</option>
            <option value="ge">Grande entreprise</option>
          </IconSelect>
          <p className="text-xs text-mizan-gris mt-1">
            Utilisée uniquement pour l'éligibilité aux dispositifs de financement, et seulement si le calcul automatique
            (effectif + chiffre d'affaires, seuils de la Charte de la PME) n'est pas possible.
          </p>
        </div>

        {error && <p className="text-sm text-mizan-alerte">{error}</p>}
        {success && <p className="text-sm text-mizan-vert">Profil mis à jour.</p>}

        <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2">
          <IconSave className="w-4 h-4" />
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>

      <div className="card">
        <SectionHeader icon={IconMapPin} title="Sites de production" />

        <ul className="divide-y divide-mizan-menthe mb-4">
          {sites.map((site) => (
            <li key={site.id} className="py-2.5 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <IconMapPin className="w-4 h-4 text-mizan-gris shrink-0" />
                {site.name} {site.city && <span className="text-mizan-gris">· {site.city}</span>}
              </span>
              <button
                onClick={() => handleDeleteSite(site.id)}
                className="flex items-center gap-1 text-sm text-mizan-alerte hover:underline"
              >
                <IconTrash className="w-3.5 h-3.5" />
                Retirer
              </button>
            </li>
          ))}
          {sites.length === 0 && <li className="py-2 text-sm text-mizan-gris">Aucun site enregistré.</li>}
        </ul>

        <form onSubmit={handleAddSite} className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="label-field" htmlFor="siteName">Nom du site</label>
            <IconInput
              id="siteName"
              icon={IconMapPin}
              required
              value={newSite.name}
              onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
            />
          </div>
          <div className="flex-1">
            <label className="label-field" htmlFor="siteCity">Ville</label>
            <IconInput
              id="siteCity"
              icon={IconMapPin}
              value={newSite.city}
              onChange={(e) => setNewSite({ ...newSite, city: e.target.value })}
            />
          </div>
          <button type="submit" className="btn-secondary inline-flex items-center gap-2">
            <IconPlus className="w-4 h-4" />
            Ajouter
          </button>
        </form>
        {sitesError && <p className="text-sm text-mizan-alerte mt-2">{sitesError}</p>}
      </div>
    </div>
  );
}
