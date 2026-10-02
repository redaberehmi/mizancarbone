import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Logo } from './Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  IconHome, IconBuilding, IconDatabase, IconCalculator, IconFileCheck,
  IconWallet, IconBell, IconChevronDown, IconLogOut, IconLeaf, IconMenu, IconX,
} from './icons.jsx';

// Doit rester synchronisé avec CBAM_COVERED_SECTORS côté serveur
// (server/src/modules/cbam-prep/constants.js) — dupliqué ici car le frontend
// ne peut pas importer un module serveur.
const CBAM_COVERED_SECTORS = ['metallurgie', 'fer_et_acier', 'aluminium', 'ciment', 'engrais', 'electricite', 'hydrogene'];

function navItemsForCompany(company) {
  const items = [
    { to: '/tableau-de-bord', label: 'Tableau de bord', icon: IconHome },
    { to: '/entreprise', label: 'Entreprise', icon: IconBuilding },
    { to: '/collecte', label: 'Collecte de données', icon: IconDatabase },
    { to: '/calcul', label: 'Calcul des émissions', icon: IconCalculator },
  ];
  // Le module reste accessible pour tous les secteurs (jamais bloqué), juste
  // libellé différemment pour signaler que ce n'est pas la priorité par
  // défaut hors métallurgie (brief, module 4).
  items.push({
    to: '/preparation-cbam',
    label: CBAM_COVERED_SECTORS.includes(company?.sector) ? 'Préparation CBAM' : 'Préparation CBAM (optionnel)',
    icon: IconFileCheck,
  });
  items.push({ to: '/financements', label: 'Financements & taxe carbone', icon: IconWallet });
  return items;
}

// Initiales dérivées du nom d'entreprise réel (ex. "Demo Metallurgie SA" ->
// "DM") — jamais un nom de personne : ce champ n'existe pas dans le modèle
// de données (seuls company.name et user.email sont disponibles).
function companyInitials(name) {
  if (!name) return '··';
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '');
  return letters.join('') || '··';
}

function SidebarContent({ navItems }) {
  return (
    <>
      <nav className="flex-1 py-4 px-2.5 space-y-0.5 text-sm">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-md font-medium border-l-2 ${
                isActive
                  ? 'bg-mizan-vert/[0.06] border-mizan-vert text-mizan-vert'
                  : 'border-transparent text-mizan-gris hover:bg-mizan-fond hover:text-mizan-ardoise'
              }`
            }
          >
            <item.icon className="w-[18px] h-[18px] shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="relative overflow-hidden p-4 m-2.5 mt-0 rounded-xl bg-mizan-vert/5 border border-mizan-vert/15">
        <IconLeaf className="absolute -bottom-2 -left-2 w-14 h-14 text-mizan-vert/10" />
        <p className="relative text-xs font-medium text-mizan-vert leading-snug">
          Des données fiables pour un avenir durable.
        </p>
      </div>
    </>
  );
}

// Mise en page type ERP : en-tête pleine largeur + navigation latérale —
// fixe sur desktop, repliée derrière un bouton menu sur mobile (sinon la
// largeur fixe de 240px écrase le contenu sur un petit écran, trouvé en
// testant la vue mobile réelle). Mêmes éléments de navigation qu'avant
// (navItemsForCompany, inchangé), présentation enrichie d'icônes.
export function Layout({ children }) {
  const { user, company, logout } = useAuth();
  const navigate = useNavigate();
  const navItems = navItemsForCompany(company);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/connexion');
  };

  return (
    <div className="min-h-screen bg-mizan-fond">
      {user && (
        <header className="h-16 bg-white border-b border-mizan-menthe flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Ouvrir la navigation"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden w-9 h-9 -ml-1 rounded-md flex items-center justify-center text-mizan-gris hover:bg-mizan-fond"
            >
              <IconMenu className="w-5 h-5" />
            </button>
            <Link to="/">
              <Logo badgeSize={34} />
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Notifications"
              className="w-9 h-9 rounded-full flex items-center justify-center text-mizan-gris hover:bg-mizan-fond hover:text-mizan-ardoise"
            >
              <IconBell className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-mizan-menthe hidden sm:block" />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-full hover:bg-mizan-fond"
              >
                <span className="w-8 h-8 rounded-full bg-mizan-vert text-white text-xs font-semibold flex items-center justify-center shrink-0">
                  {companyInitials(company?.name)}
                </span>
                <span className="text-sm font-medium text-mizan-ardoise max-w-[160px] truncate hidden sm:block">
                  {company?.name}
                </span>
                <IconChevronDown className="w-4 h-4 text-mizan-gris" />
              </button>

              {menuOpen && (
                <>
                  <button
                    aria-label="Fermer le menu"
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-xl border border-mizan-menthe shadow-panel z-50 p-1.5">
                    <div className="px-3 py-2 border-b border-mizan-menthe mb-1">
                      <p className="text-sm font-medium text-mizan-ardoise truncate">{company?.name}</p>
                      <p className="text-xs text-mizan-gris font-data truncate">{user.email}</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-mizan-alerte hover:bg-mizan-alerte/5"
                    >
                      <IconLogOut className="w-4 h-4" />
                      Déconnexion
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
      )}

      <div className="flex">
        {user && (
          <>
            {/* Desktop : barre latérale fixe, toujours visible */}
            <aside className="hidden lg:flex w-60 shrink-0 bg-white border-r border-mizan-menthe min-h-[calc(100vh-4rem)] flex-col">
              <SidebarContent navItems={navItems} />
            </aside>

            {/* Mobile : panneau coulissant par-dessus le contenu, fermé par défaut */}
            {mobileNavOpen && (
              <div className="lg:hidden fixed inset-0 z-40">
                <button
                  aria-label="Fermer la navigation"
                  className="absolute inset-0 bg-mizan-ardoise/30"
                  onClick={() => setMobileNavOpen(false)}
                />
                <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white border-r border-mizan-menthe flex flex-col">
                  <div className="h-16 flex items-center justify-between px-4 border-b border-mizan-menthe">
                    <Logo badgeSize={30} />
                    <button
                      aria-label="Fermer la navigation"
                      onClick={() => setMobileNavOpen(false)}
                      className="w-8 h-8 rounded-md flex items-center justify-center text-mizan-gris hover:bg-mizan-fond"
                    >
                      <IconX className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex-1 flex flex-col" onClick={() => setMobileNavOpen(false)}>
                    <SidebarContent navItems={navItems} />
                  </div>
                </aside>
              </div>
            )}
          </>
        )}
        <div className="flex-1 min-w-0">
          <main className="px-4 sm:px-6 lg:px-8 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
