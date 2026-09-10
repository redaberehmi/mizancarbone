import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FORBIDDEN_PHRASES } from '../src/modules/cbam-prep/constants.js';

// Vocabulaire verrouillé (brief, section 8) — non négociable. Le déclarant
// CBAM est toujours l'importateur européen, jamais l'exportateur marocain :
// cet outil structure des données, il n'en soumet aucune à une autorité ou
// un registre. Ce test scanne en texte brut tout ce qui est visible par
// l'utilisateur pour ce module (UI, PDF, messages d'erreur) et empêche
// qu'une des expressions interdites s'y glisse, y compris dans un futur
// changement.
//
// constants.js est volontairement exclu : c'est le fichier qui ÉNUMÈRE les
// expressions interdites, il les contient par nature sans être lui-même une
// chaîne visible par l'utilisateur.
const SCANNED_FILES = [
  '../src/modules/cbam-prep/cbam-prep.service.js',
  '../src/modules/cbam-prep/cbam-prep.controller.js',
  '../src/modules/cbam-prep/cbam-prep.routes.js',
  '../src/modules/reports/pdf-template.js',
  '../../client/src/pages/CbamPreparation.jsx',
  '../../client/src/components/Layout.jsx',
  '../../client/src/App.jsx',
];

describe('Vocabulaire verrouillé — module 4 (préparation CBAM)', () => {
  for (const relativePath of SCANNED_FILES) {
    it(`ne contient aucune expression interdite : ${relativePath}`, () => {
      const filePath = path.resolve(import.meta.dirname, relativePath);
      const content = readFileSync(filePath, 'utf8').toLowerCase();

      for (const phrase of FORBIDDEN_PHRASES) {
        expect(
          content.includes(phrase.toLowerCase()),
          `"${phrase}" trouvé dans ${relativePath} — vocabulaire interdit (brief, section 8).`,
        ).toBe(false);
      }
    });
  }
});
