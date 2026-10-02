// Titre de section à l'intérieur d'une carte (icône ronde + libellé) —
// purement présentationnel, utilisé pour regrouper visuellement des champs
// déjà existants sans changer leur contenu ni leur logique.
export function SectionHeader({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-8 h-8 rounded-full bg-mizan-vert/10 text-mizan-vert flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </span>
      <h2 className="font-display font-bold text-mizan-ardoise">{title}</h2>
    </div>
  );
}
