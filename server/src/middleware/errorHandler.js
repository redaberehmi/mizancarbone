export class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Ressource introuvable.' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // multer (upload de fichier) lève ses propres erreurs (taille dépassée,
  // etc.) sans statusCode — on les traite comme des erreurs client.
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: `Fichier rejeté : ${err.message}` });
  }

  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Erreur interne du serveur.' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
