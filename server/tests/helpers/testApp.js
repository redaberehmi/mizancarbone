import { createApp } from '../../src/app.js';
import { pool } from '../../src/config/db.js';

export const app = createApp();

// Réinitialise les tables entre les tests. Suppose que les migrations ont
// déjà été appliquées sur la base pointée par DATABASE_URL (base de test
// dédiée — ne jamais pointer ceci vers une base de production).
export async function resetDatabase() {
  await pool.query(`
    TRUNCATE TABLE
      base_year_recalculations,
      emission_results,
      activity_entries,
      sites,
      users,
      companies
    RESTART IDENTITY CASCADE
  `);
}

export async function closeDatabase() {
  await pool.end();
}
