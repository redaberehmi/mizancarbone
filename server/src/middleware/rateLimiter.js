import rateLimit from 'express-rate-limit';

// Protection brute-force sur les routes d'authentification (exigence section 7.4).
// Limite configurable : la valeur de production (10) doit rester basse, mais
// une suite de tests fonctionnels qui enchaîne de nombreux appels register/
// login légitimes sur la même IP a besoin d'un plafond plus haut — sinon ce
// sont les tests fonctionnels eux-mêmes qui déclenchent le 429, pas un abus.
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX) || 10;

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
});
