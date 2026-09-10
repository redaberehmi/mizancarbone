/** Charte graphique MizanCarbone — section 3 du brief produit. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'mizan-vert': '#0B6E4F',
        'mizan-vert-secondaire': '#167A5A',
        'mizan-menthe': '#BFE3D6',
        'mizan-ardoise': '#33404A',
        'mizan-gris': '#5B6670',
        'mizan-fond': '#F6F8F7',
        'mizan-alerte': '#A5342A',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
};
