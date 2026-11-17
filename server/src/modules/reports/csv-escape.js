// Échappement CSV partagé par les deux exports (rapport carbone et
// préparation CBAM).
//
// En plus des guillemets / virgules / retours à la ligne, neutralise
// l'injection de formules (CWE-1236) : une valeur texte qui commence par
// = + - @ (ou tabulation / retour chariot) serait interprétée comme une
// formule par Excel ou LibreOffice à l'ouverture. On la préfixe d'une
// apostrophe, ce qui force le tableur à l'afficher comme du texte.
// Les nombres purs (ex. "-12.5") ne sont jamais modifiés, pour ne pas
// altérer les quantités ni les tCO2e.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PURE_NUMBER = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function csvEscape(value) {
  let str = String(value ?? '');
  if (FORMULA_PREFIX.test(str) && !PURE_NUMBER.test(str)) {
    str = `'${str}`;
  }
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
