/** Charte graphique MizanCarbone — section 3 du brief produit. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'mizan-vert': '#0B6E4F',
        'mizan-vert-secondaire': '#167A5A',
        // Refonte visuelle (densité analytique type BI) : mizan-menthe reste
        // le nom du token (utilisé tel quel dans des dizaines de classes
        // Tailwind à travers l'app — bordures de tableaux, cartes, puces),
        // mais sa valeur passe d'un vert menthe franc à un gris neutre à
        // peine teinté, pour servir de ligne de grille discrète plutôt que
        // d'aplat de couleur. Aucune classe consommatrice n'a été renommée.
        'mizan-menthe': '#E1E4E6',
        'mizan-ardoise': '#24343D',
        'mizan-gris': '#5B6670',
        // Fond général gris très clair (canvas analytique), plus neutre que
        // l'ancien blanc-menthe — les surfaces de contenu restent blanches
        // (.card), créant le contraste "panneau blanc sur fond gris" visé.
        'mizan-fond': '#F5F7F8',
        'mizan-alerte': '#A5342A',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        card: '8px',
      },
      boxShadow: {
        // Ombre très discrète pour les panneaux (cartes, tuiles KPI) — un
        // seul point de vérité, réutilisé partout où .card est utilisé.
        panel: '0 1px 3px rgba(36, 52, 61, 0.03)',
      },
    },
  },
  plugins: [],
};
