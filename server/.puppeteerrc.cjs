const { join } = require('path');

// Sur Render, le cache par défaut ($HOME/.cache/puppeteer) rempli pendant le
// build n'est pas copié vers l'environnement d'exécution : Chrome était
// introuvable et tous les exports PDF renvoyaient une erreur 500. Le cache
// est placé dans le dossier du projet, qui, lui, est conservé.
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
