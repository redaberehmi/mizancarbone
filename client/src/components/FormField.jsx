import { IconChevronDown } from './icons.jsx';

// Champs de formulaire avec icône intégrée — wrapper purement visuel autour
// d'un <input>/<select> natif : toutes les props (value, onChange, required,
// id...) passent telles quelles, aucun comportement n'est changé.
export function IconInput({ icon: Icon, className = '', ...props }) {
  return (
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mizan-gris pointer-events-none" />}
      <input
        className={`w-full rounded-lg border border-mizan-gris/30 ${Icon ? 'pl-9' : 'pl-3'} pr-3 py-2 text-sm text-mizan-ardoise
          focus:outline-none focus:ring-2 focus:ring-mizan-vert/40 focus:border-mizan-vert ${className}`}
        {...props}
      />
    </div>
  );
}

export function IconSelect({ icon: Icon, className = '', children, ...props }) {
  return (
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mizan-gris pointer-events-none" />}
      <select
        className={`w-full appearance-none rounded-lg border border-mizan-gris/30 ${Icon ? 'pl-9' : 'pl-3'} pr-9 py-2 text-sm text-mizan-ardoise
          focus:outline-none focus:ring-2 focus:ring-mizan-vert/40 focus:border-mizan-vert ${className}`}
        {...props}
      >
        {children}
      </select>
      <IconChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mizan-gris pointer-events-none" />
    </div>
  );
}
