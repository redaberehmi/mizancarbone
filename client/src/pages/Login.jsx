import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ApiError } from '../api/client.js';
import {
  IconMail, IconLock, IconEye, IconEyeOff, IconBuilding, IconLeaf,
  IconFileCheck, IconTrendingUp, IconArrowRight,
} from '../components/icons.jsx';
import industrialScene from '../assets/industrial-scene.jpg';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="relative min-h-screen overflow-hidden bg-mizan-fond flex flex-col items-center justify-center px-4 py-10">
      {/* Formes décoratives d'arrière-plan — teinte menthe dédiée (pas le
          token mizan-menthe, neutralisé par la refonte du tableau de bord),
          réservée à cette page d'accueil pour un accent plus chaleureux. */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-80 h-80 rounded-full bg-[#BFE3D6]/70 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -right-28 w-96 h-96 rounded-full bg-mizan-vert/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-[#BFE3D6]/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 right-0 w-72 h-72 rounded-full bg-mizan-vert/15 blur-3xl" />

      <div className="relative w-full max-w-4xl">
        <div className="flex flex-col items-center mb-8">
          <Logo badgeSize={48} />
          <p className="text-sm text-mizan-gris mt-2">Mesurez aujourd'hui · Décarbonez demain</p>
        </div>

        <div className="bg-white rounded-2xl shadow-panel border border-mizan-menthe overflow-hidden grid lg:grid-cols-2">
          {/* Colonne formulaire */}
          <div className="p-8 sm:p-10">
            <span className="block w-10 h-1 rounded-full bg-mizan-vert mb-4" />
            <h1 className="font-display font-bold text-2xl text-mizan-ardoise">Connexion</h1>
            <p className="text-sm text-mizan-gris mt-1.5 mb-7">
              Accédez à votre espace et suivez votre empreinte carbone en toute simplicité.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label-field" htmlFor="email">Email professionnel</label>
                <div className="relative">
                  <IconMail className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-mizan-gris" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    className="w-full rounded-lg border border-mizan-gris/30 pl-10 pr-3 py-2.5 text-sm text-mizan-ardoise
                      focus:outline-none focus:ring-2 focus:ring-mizan-vert/40 focus:border-mizan-vert"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label-field" htmlFor="password">Mot de passe</label>
                <div className="relative">
                  <IconLock className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-mizan-gris" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-mizan-gris/30 pl-10 pr-10 py-2.5 text-sm text-mizan-ardoise
                      focus:outline-none focus:ring-2 focus:ring-mizan-vert/40 focus:border-mizan-vert"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-mizan-gris hover:text-mizan-ardoise"
                  >
                    {showPassword ? <IconEyeOff className="w-[18px] h-[18px]" /> : <IconEye className="w-[18px] h-[18px]" />}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-mizan-alerte">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 bg-mizan-vert hover:bg-mizan-vert-secondaire
                  text-white font-medium text-sm rounded-lg py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Connexion…' : 'Se connecter'}
                {!submitting && <IconArrowRight className="w-4 h-4" />}
              </button>
            </form>

            <div className="flex items-center gap-3 my-6">
              <span className="flex-1 h-px bg-mizan-menthe" />
              <span className="text-xs text-mizan-gris">OU</span>
              <span className="flex-1 h-px bg-mizan-menthe" />
            </div>

            <p className="text-center text-sm text-mizan-gris">
              <IconBuilding className="inline-block w-4 h-4 -mt-0.5 mr-1.5 text-mizan-gris" />
              Pas encore de compte ?{' '}
              <Link
                to="/inscription"
                className="text-mizan-vert font-medium hover:underline inline-flex items-center gap-1"
              >
                Créer un compte entreprise <IconArrowRight className="w-3.5 h-3.5" />
              </Link>
            </p>
          </div>

          {/* Colonne vitrine — photo cadrée à gauche (object-position left) :
              la partie droite de la photo source contient une maquette
              d'écran avec des chiffres fictifs, volontairement exclue du
              cadrage pour ne jamais laisser croire à une vraie capture du
              produit (voir PageHeader.jsx pour la même précaution). */}
          <div className="relative hidden lg:block text-white p-10 overflow-hidden">
            <img
              src={industrialScene}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ objectPosition: '32% center' }}
            />
            <div className="absolute inset-0 bg-gradient-to-br from-mizan-vert/85 to-[#0A5A40]/90" />
            <div className="relative z-10">
              <h2 className="font-display font-bold text-2xl leading-snug">
                Une solution carbone pour une industrie plus durable
              </h2>
              <ul className="mt-8 space-y-5">
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center">
                    <IconLeaf className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="font-semibold">Mesurez vos émissions</p>
                    <p className="text-sm text-white/75">Scopes 1, 2 et 3</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center">
                    <IconFileCheck className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="font-semibold">Préparez vos données</p>
                    <p className="text-sm text-white/75">CBAM, VSME, EcoVadis, CDP</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center">
                    <IconTrendingUp className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="font-semibold">Accédez aux financements</p>
                    <p className="text-sm text-white/75">Publics et privés</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
