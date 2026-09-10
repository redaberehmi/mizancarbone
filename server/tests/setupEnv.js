import { readFileSync } from 'node:fs';
import { HANDOFF_FILE } from './globalSetup.js';

const { connectionString } = JSON.parse(readFileSync(HANDOFF_FILE, 'utf8'));

process.env.DATABASE_URL = connectionString;
process.env.JWT_SECRET = 'test-secret-not-for-production-use-only-in-ci';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
// Plafond haut pour ne pas faire échouer les tests fonctionnels sur le rate
// limiter lui-même — celui-ci reste actif (limite réelle) en production.
process.env.AUTH_RATE_LIMIT_MAX = '1000';
