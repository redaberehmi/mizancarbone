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
    <div className="flex flex-col md:flex-row md:items-stretch gap-4 mb-6">
      <div className="flex items-start gap-4 flex-1 min-w-0">
        {Icon && (
          <span className="shrink-0 w-14 h-14 rounded-xl bg-mizan-vert text-white flex items-center justify-center shadow-panel">
            <Icon className="w-7 h-7" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="font-display font-bold text-2xl text-mizan-ardoise">{title}</h1>
            {actions && <div className="flex gap-2">{actions}</div>}
          </div>
          {subtitle && <p className="text-mizan-gris text-sm mt-1 max-w-xl">{subtitle}</p>}
        </div>
      </div>
      {banner && (
        <div className="relative hidden md:block w-72 shrink-0 h-24 rounded-2xl overflow-hidden">
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
