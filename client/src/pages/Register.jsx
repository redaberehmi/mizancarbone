import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ApiError } from '../api/client.js';

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
    <div className="min-h-screen flex items-center justify-center bg-mizan-fond px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo badgeSize={44} />
        </div>
        <div className="card">
          <h1 className="font-display font-bold text-lg text-mizan-ardoise mb-1">Créer votre compte entreprise</h1>
          <p className="text-sm text-mizan-gris mb-6">
            Un compte = une entreprise. Vous pourrez ajouter vos sites de production ensuite.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label-field" htmlFor="companyName">Nom de l'entreprise</label>
              <input id="companyName" required className="input-field" value={form.companyName} onChange={update('companyName')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label-field" htmlFor="sector">Secteur d'activité</label>
                <select id="sector" required className="input-field" value={form.sector} onChange={update('sector')}>
                  <option value="" disabled>Choisir…</option>
                  {SECTORS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-field" htmlFor="headcount">Effectif</label>
                <input id="headcount" type="number" min="1" className="input-field" value={form.headcount} onChange={update('headcount')} />
              </div>
            </div>
            <div>
              <label className="label-field" htmlFor="email">Email professionnel</label>
              <input id="email" type="email" required className="input-field" value={form.email} onChange={update('email')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label-field" htmlFor="password">Mot de passe</label>
                <input id="password" type="password" required minLength={10} className="input-field" value={form.password} onChange={update('password')} />
              </div>
              <div>
                <label className="label-field" htmlFor="passwordConfirm">Confirmer</label>
                <input id="passwordConfirm" type="password" required minLength={10} className="input-field" value={form.passwordConfirm} onChange={update('passwordConfirm')} />
              </div>
            </div>
            <p className="text-xs text-mizan-gris">Au moins 10 caractères.</p>
            {error && <p className="text-sm text-mizan-alerte">{error}</p>}
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Création…' : 'Créer mon compte'}
            </button>
          </form>
        </div>
        <p className="text-center text-sm text-mizan-gris mt-4">
          Déjà un compte ? <Link to="/connexion" className="text-mizan-vert font-medium">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
