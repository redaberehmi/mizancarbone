import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from '../../config/db.js';

const seedDir = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const files = readdirSync(seedDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(seedDir, file), 'utf8');
    console.log(`Seed : ${file}`);
    await pool.query(sql);
  }

  await pool.end();
  console.log('Seed terminé.');
}

run().catch((err) => {
  console.error('Échec du seed :', err);
  process.exit(1);
});
