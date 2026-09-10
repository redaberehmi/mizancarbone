import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ApiError } from '../api/client.js';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(form);
      navigate('/entreprise');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de connexion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-mizan-fond px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo badgeSize={44} />
        </div>
        <div className="card">
          <h1 className="font-display font-bold text-lg text-mizan-ardoise mb-6">Connexion</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label-field" htmlFor="email">Email professionnel</label>
              <input
                id="email"
                type="email"
                required
                className="input-field"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field" htmlFor="password">Mot de passe</label>
              <input
                id="password"
                type="password"
                required
                className="input-field"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            {error && <p className="text-sm text-mizan-alerte">{error}</p>}
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>
        <p className="text-center text-sm text-mizan-gris mt-4">
          Pas encore de compte ? <Link to="/inscription" className="text-mizan-vert font-medium">Créer un compte entreprise</Link>
        </p>
      </div>
    </div>
  );
}
