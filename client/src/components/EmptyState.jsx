// État vide explicite, jamais un tableau silencieux : un module sans
// contenu doit rassurer ("c'est normal, ça arrive") plutôt que ressembler à
// une fonctionnalité cassée ou abandonnée.
export function EmptyState({ title, description, children }) {
  return (
    <div className="empty-state">
      <span className="badge-a-venir mb-3">À venir</span>
      <h3 className="font-display font-bold text-mizan-ardoise mb-1">{title}</h3>
      <p className="text-sm text-mizan-gris max-w-md mx-auto">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
