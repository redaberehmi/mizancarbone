import industrialScene from '../assets/industrial-scene.jpg';

// En-tête de page partagé — icône de badge, titre, sous-titre, et bannière
// décorative optionnelle. Utilisé par toutes les pages pour une présentation
// cohérente ; ne porte aucune donnée, uniquement de la présentation.
//
// La bannière utilise une vraie photo (fournie par l'utilisateur) cadrée sur
// sa partie haute (ciel, usine, icônes Scope 1/2/3, éolienne) via
// object-position: top — la partie basse de la photo source contient une
// maquette d'écran avec des chiffres fictifs (2 845 tCO2e, répartition
// 72/18/10%, sites inventés) qui ne correspondent pas à l'application
// réelle ; ce cadrage l'exclut délibérément pour ne jamais laisser croire
// qu'il s'agit d'une vraie capture du produit.
export function PageHeader({ icon: Icon, title, subtitle, banner = true, actions }) {
  return (
    <div className="page-header flex flex-col xl:flex-row xl:items-center gap-5 mb-6">
      <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
        {Icon && (
          <span className="page-header-icon shrink-0 w-11 h-11 rounded-lg flex items-center justify-center">
            <Icon className="w-6 h-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="font-display font-semibold text-2xl sm:text-[28px] tracking-tight text-mizan-ardoise">{title}</h1>
            {actions && <div className="page-actions flex flex-wrap gap-2">{actions}</div>}
          </div>
          {subtitle && <p className="text-mizan-gris text-sm leading-relaxed mt-2 max-w-2xl">{subtitle}</p>}
        </div>
      </div>
      {banner && (
        <div className="page-header-banner relative hidden xl:block w-36 shrink-0 h-16 rounded-lg overflow-hidden">
          <img
            src={industrialScene}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-mizan-vert/80 to-[#0A5A40]/70" />
        </div>
      )}
    </div>
  );
}
