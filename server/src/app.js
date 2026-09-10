import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import companiesRoutes from './modules/companies/companies.routes.js';
import activityEntriesRoutes from './modules/activity-entries/activity-entries.routes.js';
import calculationRoutes from './modules/calculation/calculation.routes.js';
import cbamPrepRoutes from './modules/cbam-prep/cbam-prep.routes.js';
import financingRoutes from './modules/financing/financing.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  // Origine unique et explicite — jamais de wildcard '*' (exigence section 7.10).
  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/companies', companiesRoutes);
  app.use('/api/activity-entries', activityEntriesRoutes);
  app.use('/api/calculations', calculationRoutes);
  app.use('/api/cbam-prep', cbamPrepRoutes);
  app.use('/api/financing', financingRoutes);
  app.use('/api/reports', reportsRoutes);

  // Sert le build React (client/dist) depuis le même serveur/la même origine
  // que l'API — évite tout problème de cookie tiers (SameSite) qui
  // apparaîtrait si le frontend et l'API étaient déployés sur deux domaines
  // séparés (ex. deux sous-domaines *.onrender.com distincts). N'a aucun
  // effet en développement : le dossier n'existe que si un build a été fait
  // (`npm run build` côté client), et Vite sert le frontend séparément en dev.
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
