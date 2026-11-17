import { IconChevronDown } from './icons.jsx';

// Champs de formulaire avec icône intégrée — wrapper purement visuel autour
// d'un <input>/<select> natif : toutes les props (value, onChange, required,
// id...) passent telles quelles, aucun comportement n'est changé.
export function IconInput({ icon: Icon, className = '', ...props }) {
  return (
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mizan-gris pointer-events-none" />}
      <input
        className={`input-field ${Icon ? 'pl-9' : 'pl-3'} pr-3 ${className}`}
        {...props}
      />
    </div>
  );
}

export function IconSelect({ icon: Icon, className = '', children, ...props }) {
  return (
    <div className={`relative ${className}`}>
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mizan-gris pointer-events-none" />}
      <select
        className={`input-field appearance-none ${Icon ? 'pl-9' : 'pl-3'} pr-9 ${className}`}
        {...props}
      >
        {children}
      </select>
      <IconChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mizan-gris pointer-events-none" />
    </div>
  );
}
