import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Logo } from './Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Doit rester synchronisé avec CBAM_COVERED_SECTORS côté serveur
// (server/src/modules/cbam-prep/constants.js) — dupliqué ici car le frontend
// ne peut pas importer un module serveur.
const CBAM_COVERED_SECTORS = ['metallurgie', 'fer_et_acier', 'aluminium', 'ciment', 'engrais', 'electricite', 'hydrogene'];

function navItemsForCompany(company) {
  const items = [
    { to: '/tableau-de-bord', label: 'Tableau de bord' },
    { to: '/entreprise', label: 'Entreprise' },
    { to: '/collecte', label: 'Collecte de données' },
    { to: '/calcul', label: 'Calcul des émissions' },
  ];
  // Le module reste accessible pour tous les secteurs (jamais bloqué), juste
  // libellé différemment pour signaler que ce n'est pas la priorité par
  // défaut hors métallurgie (brief, module 4).
  items.push({
    to: '/preparation-cbam',
    label: CBAM_COVERED_SECTORS.includes(company?.sector) ? 'Préparation CBAM' : 'Préparation CBAM (optionnel)',
  });
  items.push({ to: '/financements', label: 'Financements & taxe carbone' });
  return items;
}

export function Layout({ children }) {
  const { user, company, logout } = useAuth();
  const navigate = useNavigate();
  const navItems = navItemsForCompany(company);

  const handleLogout = async () => {
    await logout();
    navigate('/connexion');
  };

  return (
    <div className="min-h-screen bg-mizan-fond">
      <header className="bg-white border-b border-mizan-menthe/60">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <Link to="/">
            <Logo />
          </Link>
          {user && (
            <nav className="flex items-center gap-1 text-sm">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-lg font-medium ${
                      isActive ? 'bg-mizan-menthe/40 text-mizan-vert' : 'text-mizan-gris hover:text-mizan-vert'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
          {user && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-mizan-gris">
                {company?.name} · <span className="font-data">{user.email}</span>
              </span>
              <button onClick={handleLogout} className="btn-secondary py-1.5 px-3">
                Déconnexion
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
