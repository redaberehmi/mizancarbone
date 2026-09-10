import bcrypt from 'bcrypt';
import { pool, withTransaction } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';

const BCRYPT_ROUNDS = 12;

export async function registerCompanyAndUser({ companyName, sector, headcount, email, password }) {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new AppError(409, 'Un compte existe déjà avec cet email.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  return withTransaction(async (client) => {
    const companyResult = await client.query(
      `INSERT INTO companies (name, sector, headcount)
       VALUES ($1, $2, $3)
       RETURNING id, name, sector, headcount, base_year, created_at`,
      [companyName, sector, headcount ?? null],
    );
    const company = companyResult.rows[0];

    const userResult = await client.query(
      `INSERT INTO users (company_id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, company_id, email, created_at`,
      [company.id, email, passwordHash],
    );
    const user = userResult.rows[0];

    return { company, user };
  });
}

export async function authenticate({ email, password }) {
  const result = await pool.query(
    `SELECT id, company_id, email, password_hash FROM users WHERE email = $1`,
    [email],
  );
  const user = result.rows[0];

  // Message générique volontairement identique dans les deux cas (email
  // inconnu / mot de passe faux) pour ne pas révéler si un email est inscrit.
  if (!user) {
    // Hash bidon (jamais utilisé) uniquement pour égaliser le temps de
    // réponse avec le cas "mot de passe incorrect" et éviter l'énumération d'emails.
    await bcrypt.compare(password, '$2a$12$CwTycUXWue0Thq9StjUM0uJ8mAmGaW9djLTA9r5RXBg0lzS0nHnKO');
    throw new AppError(401, 'Identifiants invalides.');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError(401, 'Identifiants invalides.');
  }

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

  return { userId: user.id, companyId: user.company_id, email: user.email };
}

export async function getUserWithCompany(userId, companyId) {
  const result = await pool.query(
    `SELECT u.id AS user_id, u.email, u.created_at AS user_created_at, u.last_login_at,
            c.id AS company_id, c.name, c.sector, c.headcount, c.base_year, c.created_at AS company_created_at
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE u.id = $1 AND u.company_id = $2`,
    [userId, companyId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Utilisateur introuvable.');
  }

  return result.rows[0];
}
