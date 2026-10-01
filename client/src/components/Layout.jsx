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

// Mise en page type ERP : navigation latérale fixe + zone de contenu pleine
// largeur sur fond gris clair — mêmes éléments de navigation qu'avant
// (navItemsForCompany, inchangé), seule la disposition change (ligne
// horizontale -> colonne latérale).
export function Layout({ children }) {
  const { user, company, logout } = useAuth();
  const navigate = useNavigate();
  const navItems = navItemsForCompany(company);

  const handleLogout = async () => {
    await logout();
    navigate('/connexion');
  };

  return (
    <div className="min-h-screen bg-mizan-fond flex">
      {user && (
        <aside className="w-60 shrink-0 bg-white border-r border-mizan-menthe flex flex-col">
          <div className="h-16 flex items-center px-5 border-b border-mizan-menthe">
            <Link to="/">
              <Logo badgeSize={30} />
            </Link>
          </div>
          <nav className="flex-1 py-3 px-2 space-y-0.5 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-md font-medium border-l-2 ${
                    isActive
                      ? 'bg-mizan-vert/[0.06] border-mizan-vert text-mizan-vert'
                      : 'border-transparent text-mizan-gris hover:bg-mizan-fond hover:text-mizan-ardoise'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-mizan-menthe p-4 text-xs">
            <p className="font-medium text-mizan-ardoise truncate">{company?.name}</p>
            <p className="text-mizan-gris font-data truncate">{user.email}</p>
            <button onClick={handleLogout} className="btn-secondary w-full mt-3 py-1.5">
              Déconnexion
            </button>
          </div>
        </aside>
      )}
      <div className="flex-1 min-w-0">
        <main className="px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
