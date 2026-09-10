import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Badge SVG repris tel quel du brief (section 3) — réutilisé dans le header
// de chaque PDF généré par l'application. Ne pas dupliquer ailleurs : si le
// badge change, ce fichier est la seule source à modifier pour les PDF.
const BADGE_SVG = `<svg viewBox="0 0 200 200" width="28" height="28">
  <rect width="200" height="200" rx="32" fill="#0B6E4F"/>
  <line x1="55" y1="90" x2="145" y2="90" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"/>
  <circle cx="55" cy="80" r="10" fill="#FFFFFF"/>
  <circle cx="145" cy="80" r="10" fill="#FFFFFF"/>
  <path d="M100 90 L84 122 L116 122 Z" fill="#FFFFFF"/>
  <line x1="80" y1="122" x2="120" y2="122" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>
</svg>`;

// Polices auto-hébergées, embarquées en base64 (data URI) — aucun appel
// réseau à la génération d'un PDF, contrairement à un <link> Google Fonts
// qui dépendrait d'un accès sortant disponible à chaque requête. IBM Plex
// Sans et Space Grotesk sont des polices variables chez Google Fonts : un
// seul fichier physique couvre plusieurs graisses (400/500/600 pour Sans,
// 400/700 pour Grotesk), d'où le nombre de fichiers réellement présents
// dans fonts/ (4) inférieur au nombre de règles @font-face ci-dessous (7).
const FONTS_DIR = path.resolve(import.meta.dirname, 'fonts');

function fontDataUri(filename) {
  const buffer = readFileSync(path.join(FONTS_DIR, filename));
  return `data:font/woff2;base64,${buffer.toString('base64')}`;
}

const FONT_FACES = `
  @font-face {
    font-family: 'IBM Plex Mono';
    font-weight: 400;
    font-style: normal;
    src: url(${fontDataUri('ibm-plex-mono-400.woff2')}) format('woff2');
  }
  @font-face {
    font-family: 'IBM Plex Mono';
    font-weight: 500;
    font-style: normal;
    src: url(${fontDataUri('ibm-plex-mono-500.woff2')}) format('woff2');
  }
  @font-face {
    font-family: 'IBM Plex Sans';
    font-weight: 400 600;
    font-style: normal;
    src: url(${fontDataUri('ibm-plex-sans-variable.woff2')}) format('woff2');
  }
  @font-face {
    font-family: 'Space Grotesk';
    font-weight: 400 700;
    font-style: normal;
    src: url(${fontDataUri('space-grotesk-variable.woff2')}) format('woff2');
  }
`;

// Gabarit HTML brandé partagé par tous les exports PDF de l'application
// (Module 4 en premier, réutilisé tel quel par le Module 6). Centralise la
// charte graphique (section 3) pour ne pas la redupliquer à chaque module.
export function renderBrandedHtml({ title, companyName, generatedAtLabel, bodyHtml }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  ${FONT_FACES}
  @page { margin: 20mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans', Arial, sans-serif;
    color: #33404A;
    font-size: 12px;
    margin: 0;
  }
  h1, h2, h3 { font-family: 'Space Grotesk', Arial, sans-serif; color: #33404A; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  .mono { font-family: 'IBM Plex Mono', monospace; }
  header.doc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 2px solid #BFE3D6;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .brand { display: flex; align-items: center; gap: 8px; }
  .brand .wordmark { font-family: 'Space Grotesk', Arial, sans-serif; font-size: 16px; }
  .brand .wordmark b { color: #0B6E4F; }
  .brand .wordmark span { color: #5B6670; }
  .meta { text-align: right; font-size: 11px; color: #5B6670; }
  .callout {
    border: 1px solid rgba(165,52,42,0.35);
    background: rgba(165,52,42,0.05);
    border-radius: 8px;
    padding: 10px 14px;
    color: #A5342A;
    font-size: 11.5px;
    margin: 12px 0 20px;
  }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { text-align: left; padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #BFE3D6; }
  th { color: #5B6670; font-weight: 600; }
  .badge-generique {
    display: inline-block;
    font-size: 9.5px;
    color: #A5342A;
    border: 1px solid rgba(165,52,42,0.4);
    border-radius: 999px;
    padding: 1px 6px;
    margin-left: 4px;
  }
  footer.doc-footer {
    margin-top: 24px;
    padding-top: 8px;
    border-top: 1px solid #BFE3D6;
    font-size: 10px;
    color: #5B6670;
  }
</style>
</head>
<body>
  <header class="doc-header">
    <div class="brand">
      ${BADGE_SVG}
      <span class="wordmark"><b>mizan</b><span>carbone</span></span>
    </div>
    <div class="meta">
      ${companyName ? `<div>${escapeHtml(companyName)}</div>` : ''}
      <div>Généré le ${escapeHtml(generatedAtLabel)}</div>
    </div>
  </header>
  <h1>${escapeHtml(title)}</h1>
  ${bodyHtml}
  <footer class="doc-footer">
    mizancarbone — outil de préparation interne de données carbone. Ce document
    est structuré selon le GHG Protocol / ISO 14064-1.
  </footer>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export async function htmlToPdfBuffer(html) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    // Les polices sont des data URI embarquées (aucune requête réseau), mais
    // leur parsing/application au rendu reste asynchrone côté navigateur —
    // on attend explicitement document.fonts.ready pour ne jamais imprimer
    // une page qui serait retombée sur une police de repli par timing.
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    // Les versions récentes de Puppeteer renvoient un Uint8Array, pas un
    // Buffer Node — sans cette conversion, .toString() et d'autres API
    // orientées Buffer (res.send, comparaisons de magic bytes) ne se
    // comportent pas comme attendu.
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
