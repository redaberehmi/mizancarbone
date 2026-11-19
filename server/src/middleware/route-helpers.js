import { AppError } from './errorHandler.js';

// Enveloppe un handler async : toute erreur part vers errorHandler.
export function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

export function parseOr400(schema, data, message = 'Données invalides.') {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError(400, message, parsed.error.flatten());
  return parsed.data;
}

export function idParam(req, name) {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Identifiant invalide.');
  return id;
}
