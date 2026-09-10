import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';

const COOKIE_NAME = 'mizancarbone_token';

export function issueAuthCookie(res, payload) {
  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Authentifie la requête et attache req.auth = { userId, companyId }.
// company_id ne provient JAMAIS du corps/query de la requête client :
// il est extrait exclusivement du token signé serveur (exigence section 7.1).
export function authGuard(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return next(new AppError(401, 'Authentification requise.'));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.auth = { userId: payload.userId, companyId: payload.companyId };
    next();
  } catch {
    return next(new AppError(401, 'Session invalide ou expirée.'));
  }
}
