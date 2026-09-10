import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';

const company = {
  companyName: 'Metal Forge SA',
  sector: 'metallurgie',
  email: 'contact@metalforge.ma',
  password: 'mot-de-passe-solide-123',
};

let agent;

beforeEach(async () => {
  await resetDatabase();
  agent = request.agent(app);
  await agent.post('/api/auth/register').send(company);
});

afterAll(async () => {
  await closeDatabase();
});

describe('base_year — traçabilité des recalculs (section 5, module 3)', () => {
  it("n'exige aucune raison ni trace au tout premier réglage de base_year", async () => {
    const res = await agent.put('/api/companies/me').send({ baseYear: 2023 });
    expect(res.status).toBe(200);
    expect(res.body.company.baseYear).toBe(2023);

    const companyId = res.body.company.id;
    const trace = await pool.query('SELECT * FROM base_year_recalculations WHERE company_id = $1', [companyId]);
    expect(trace.rows).toHaveLength(0);
  });

  it('refuse (400) un changement de base_year déjà établi sans raison, ne modifie rien', async () => {
    await agent.put('/api/companies/me').send({ baseYear: 2023 });

    const res = await agent.put('/api/companies/me').send({ baseYear: 2024 });
    expect(res.status).toBe(400);

    const me = await agent.get('/api/companies/me');
    expect(me.body.company.baseYear).toBe(2023);
  });

  it('accepte un changement de base_year déjà établi avec une raison, et trace le recalcul', async () => {
    const first = await agent.put('/api/companies/me').send({ baseYear: 2023 });
    const companyId = first.body.company.id;

    const res = await agent.put('/api/companies/me').send({
      baseYear: 2024,
      baseYearChangeReason: 'Cession du site de Tanger',
    });
    expect(res.status).toBe(200);
    expect(res.body.company.baseYear).toBe(2024);

    const trace = await pool.query(
      'SELECT previous_base_year, new_base_year, reason FROM base_year_recalculations WHERE company_id = $1',
      [companyId],
    );
    expect(trace.rows).toHaveLength(1);
    expect(trace.rows[0].previous_base_year).toBe(2023);
    expect(trace.rows[0].new_base_year).toBe(2024);
    expect(trace.rows[0].reason).toBe('Cession du site de Tanger');
  });

  it("ne trace rien et n'exige rien si base_year ne change pas réellement", async () => {
    const first = await agent.put('/api/companies/me').send({ baseYear: 2023 });
    const companyId = first.body.company.id;

    const res = await agent.put('/api/companies/me').send({ baseYear: 2023, name: 'Metal Forge SA' });
    expect(res.status).toBe(200);

    const trace = await pool.query('SELECT * FROM base_year_recalculations WHERE company_id = $1', [companyId]);
    expect(trace.rows).toHaveLength(0);
  });
});
