import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ApiError } from '../api/client.js';
import { IconInput, IconSelect } from '../components/FormField.jsx';
import { IconBuilding, IconUsers, IconMail, IconLock, IconArrowRight } from '../components/icons.jsx';

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

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    companyName: '',
    sector: '',
    headcount: '',
    email: '',
    password: '',
    passwordConfirm: '',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (form.password !== form.passwordConfirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        companyName: form.companyName,
        sector: form.sector,
        headcount: form.headcount ? Number(form.headcount) : undefined,
        email: form.email,
        password: form.password,
      });
      navigate('/entreprise');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur lors de l'inscription.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-mizan-fond flex items-center justify-center px-4 py-10">
      {/* Formes décoratives — mêmes réglages que la page de connexion pour
          une identité visuelle cohérente sur les deux écrans d'accès. */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-80 h-80 rounded-full bg-[#BFE3D6]/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-16 w-96 h-96 rounded-full bg-mizan-vert/15 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo badgeSize={44} />
        </div>
        <div className="bg-white rounded-2xl shadow-panel border border-mizan-menthe p-8">
          <span className="block w-10 h-1 rounded-full bg-mizan-vert mb-4" />
          <h1 className="font-display font-bold text-xl text-mizan-ardoise mb-1">Créer votre compte entreprise</h1>
          <p className="text-sm text-mizan-gris mb-6">
            Un compte = une entreprise. Vous pourrez ajouter vos sites de production ensuite.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label-field" htmlFor="companyName">Nom de l'entreprise</label>
              <IconInput id="companyName" icon={IconBuilding} required value={form.companyName} onChange={update('companyName')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label-field" htmlFor="sector">Secteur d'activité</label>
                <IconSelect id="sector" icon={IconBuilding} required value={form.sector} onChange={update('sector')}>
                  <option value="" disabled>Choisir…</option>
                  {SECTORS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </IconSelect>
              </div>
              <div>
                <label className="label-field" htmlFor="headcount">Effectif</label>
                <IconInput id="headcount" icon={IconUsers} type="number" min="1" value={form.headcount} onChange={update('headcount')} />
              </div>
            </div>
            <div>
              <label className="label-field" htmlFor="email">Email professionnel</label>
              <IconInput id="email" icon={IconMail} type="email" required value={form.email} onChange={update('email')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label-field" htmlFor="password">Mot de passe</label>
                <IconInput id="password" icon={IconLock} type="password" required minLength={10} value={form.password} onChange={update('password')} />
              </div>
              <div>
                <label className="label-field" htmlFor="passwordConfirm">Confirmer</label>
                <IconInput id="passwordConfirm" icon={IconLock} type="password" required minLength={10} value={form.passwordConfirm} onChange={update('passwordConfirm')} />
              </div>
            </div>
            <p className="text-xs text-mizan-gris">Au moins 10 caractères.</p>
            {error && <p className="text-sm text-mizan-alerte">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 bg-mizan-vert hover:bg-mizan-vert-secondaire
                text-white font-medium text-sm rounded-lg py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Création…' : 'Créer mon compte'}
              {!submitting && <IconArrowRight className="w-4 h-4" />}
            </button>
          </form>
        </div>
        <p className="text-center text-sm text-mizan-gris mt-4">
          Déjà un compte ? <Link to="/connexion" className="text-mizan-vert font-medium hover:underline">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
