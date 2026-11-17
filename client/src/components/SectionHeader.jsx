// Titre de section à l'intérieur d'une carte (icône ronde + libellé) —
// purement présentationnel, utilisé pour regrouper visuellement des champs
// déjà existants sans changer leur contenu ni leur logique.
export function SectionHeader({ icon: Icon, title }) {
  return (
    <div className="section-header flex items-center gap-3 mb-5">
      <span className="w-9 h-9 shrink-0 rounded-xl bg-mizan-vert/[0.07] text-mizan-vert flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </span>
      <h2 className="font-display font-semibold text-lg tracking-tight text-mizan-ardoise">{title}</h2>
    </div>
  );
}
