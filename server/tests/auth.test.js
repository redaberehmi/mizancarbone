import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';

const validPayload = {
  companyName: 'Textile Atlas SARL',
  sector: 'textile',
  headcount: 120,
  email: 'contact@textile-atlas.ma',
  password: 'motdepasse-solide-123',
};

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('POST /api/auth/register', () => {
  it("crée une entreprise et un utilisateur, renvoie un cookie de session", async () => {
    const res = await request(app).post('/api/auth/register').send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.company.name).toBe(validPayload.companyName);
    expect(res.body.user.email).toBe(validPayload.email);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('refuse un email déjà utilisé (409)', async () => {
    await request(app).post('/api/auth/register').send(validPayload);
    const res = await request(app).post('/api/auth/register').send(validPayload);

    expect(res.status).toBe(409);
  });

  it('refuse un mot de passe trop court (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validPayload, email: 'autre@textile-atlas.ma', password: 'short' });

    expect(res.status).toBe(400);
  });

  it('refuse un secteur hors liste (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validPayload, email: 'autre2@textile-atlas.ma', sector: 'inconnu' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(validPayload);
  });

  it('connecte avec les bons identifiants', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: validPayload.password });

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('refuse un mauvais mot de passe (401)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: 'mauvais-mot-de-passe' });

    expect(res.status).toBe(401);
  });

  it('refuse un email inconnu (401, message identique)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inconnu@example.com', password: 'peu-importe-123' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('refuse sans cookie de session (401)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('renvoie le profil utilisateur + entreprise quand authentifié', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(validPayload);

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe(validPayload.companyName);
  });
});
