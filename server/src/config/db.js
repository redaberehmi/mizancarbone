import pg from 'pg';
import { env } from './env.js';

const { Pool, types } = pg;

// Par défaut, node-postgres convertit les colonnes DATE en objets JS Date à
// minuit LOCAL, puis res.json() les sérialise via toISOString() en UTC — ce
// qui décale visiblement la date (ex: 2024-01-01 devient
// "2023-12-31T23:00:00.000Z" au Maroc, UTC+1). On garde les DATE en simple
// chaîne "AAAA-MM-JJ" (type OID 1082), ce qui correspond à ce que l'API et
// les formulaires attendent partout (activity_entries, emission_factors,
// carbon_tax_parameters...).
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

// Toujours utiliser des requêtes paramétrées ($1, $2, ...) — jamais de
// concaténation de chaînes SQL. Voir exigence de sécurité section 7.5.
export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
