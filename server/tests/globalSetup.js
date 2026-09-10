import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';

// Postgres embarqué utilisé UNIQUEMENT pour l'exécution des tests
// automatisés — jamais en production. Permet de lancer `npm test` sans
// dépendre d'une installation PostgreSQL locale. La connexion est transmise
// aux workers de test via un fichier (tests/setupEnv.js la relit), car
// process.env défini ici n'est pas garanti de traverser les threads workers.
const PORT = 54329;
const USER = 'mizancarbone_test';
const PASSWORD = 'mizancarbone_test';
const DB_NAME = 'mizancarbone_test';

export const HANDOFF_FILE = path.resolve('.tmp-test-pg-handoff.json');

let pgServer;
let dataDir;

export async function setup() {
  dataDir = mkdtempSync(path.join(tmpdir(), 'mizancarbone-pg-'));

  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    // persistent:true évite que stop() essaie de supprimer databaseDir en
    // interne (fs.rm) juste après avoir tué postgres.exe : sous Windows, les
    // handles de fichiers ne sont pas toujours libérés assez vite et ça
    // faisait échouer stop() avec EBUSY. Le dossier temporaire (mkdtempSync,
    // un par run) est nettoyé par l'OS, pas par nous.
    persistent: true,
  });

  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase(DB_NAME);

  const connectionString = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DB_NAME}`;

  const client = new pg.Client({ connectionString });
  await client.connect();
  const migrationsDir = path.resolve('src/db/migrations');
  const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    const migrationSql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const upSql = migrationSql.split('-- Down Migration')[0];
    await client.query(upSql);
  }

  // Seed emission_factors : les tests du Module 2 (saisie énergie) ont
  // besoin de codes de facteurs réels pour valider les entrées.
  const seedDir = path.resolve('src/db/seed');
  const seedFiles = readdirSync(seedDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of seedFiles) {
    const seedSql = readFileSync(path.join(seedDir, file), 'utf8');
    await client.query(seedSql);
  }

  await client.end();

  writeFileSync(HANDOFF_FILE, JSON.stringify({ connectionString }));
}

export async function teardown() {
  if (pgServer) {
    try {
      await pgServer.stop();
    } catch (err) {
      console.warn('Arrêt de Postgres embarqué : nettoyage best-effort, erreur ignorée :', err.message);
    }
  }
  try {
    rmSync(HANDOFF_FILE, { force: true });
  } catch {
    // best-effort cleanup
  }
  // Le dossier de données temporaire (mkdtempSync) n'est volontairement pas
  // supprimé ici : sous Windows, pg_ctl stop() peut rendre la main avant que
  // le processus postgres.exe ait totalement libéré ses handles de fichiers,
  // ce qui fait échouer un rmSync immédiat (EBUSY). Le dossier reste dans le
  // répertoire temp OS, qui est nettoyé périodiquement par le système.

}
