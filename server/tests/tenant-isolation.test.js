import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';

// Exigence section 7.1 : un utilisateur de l'entreprise A ne doit jamais
// pouvoir obtenir ou modifier une donnée de l'entreprise B, y compris en
// devinant/incrémentant des IDs numériques.

const companyA = {
  companyName: 'Metal Forge SA',
  sector: 'metallurgie',
  email: 'a@metal-forge.ma',
  password: 'mot-de-passe-solide-A1',
};

const companyB = {
  companyName: 'AutoParts Maroc SA',
  sector: 'automobile',
  email: 'b@autoparts.ma',
  password: 'mot-de-passe-solide-B1',
};

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('Isolation multi-tenant', () => {
  it("empêche l'entreprise B de lire un site créé par l'entreprise A (ID deviné)", async () => {
    const agentA = request.agent(app);
    await agentA.post('/api/auth/register').send(companyA);
    const siteRes = await agentA.post('/api/companies/me/sites').send({ name: 'Site Tanger', city: 'Tanger' });
    expect(siteRes.status).toBe(201);
    const siteId = siteRes.body.site.id;

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send(companyB);

    // B ne doit voir aucun site de A dans sa propre liste.
    const listRes = await agentB.get('/api/companies/me/sites');
    expect(listRes.status).toBe(200);
    expect(listRes.body.sites).toHaveLength(0);

    // B tente de modifier le site de A en devinant son ID.
    const updateRes = await agentB
      .put(`/api/companies/me/sites/${siteId}`)
      .send({ name: 'Site piraté' });
    expect(updateRes.status).toBe(404);

    // B tente de supprimer le site de A.
    const deleteRes = await agentB.delete(`/api/companies/me/sites/${siteId}`);
    expect(deleteRes.status).toBe(404);

    // Le site de A doit être intact.
    const stillThere = await agentA.get('/api/companies/me/sites');
    expect(stillThere.body.sites[0].name).toBe('Site Tanger');
  });

  it("empêche B de lire le profil entreprise de A même avec le company_id de A", async () => {
    const agentA = request.agent(app);
    await agentA.post('/api/auth/register').send(companyA);
    const meA = await agentA.get('/api/companies/me');
    const companyAId = meA.body.company.id;

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send(companyB);

    // Même en essayant d'injecter le company_id de A dans le corps de la
    // requête, le serveur doit ignorer toute valeur cliente et utiliser
    // exclusivement le company_id extrait du token de session de B.
    const res = await agentB.put('/api/companies/me').send({ id: companyAId, name: 'Hack' });
    expect(res.status).toBe(200);
    expect(res.body.company.id).not.toBe(companyAId);
    expect(res.body.company.name).toBe('Hack');

    const meAAgain = await agentA.get('/api/companies/me');
    expect(meAAgain.body.company.name).toBe(companyA.companyName);
  });

  it('rejette toute requête sur /api/companies/me sans authentification', async () => {
    const res = await request(app).get('/api/companies/me');
    expect(res.status).toBe(401);
  });

  it("empêche B de créer, lire ou supprimer les activity_entries de A (site et entrée devinés)", async () => {
    const agentA = request.agent(app);
    await agentA.post('/api/auth/register').send(companyA);
    const siteRes = await agentA.post('/api/companies/me/sites').send({ name: 'Site Tanger', city: 'Tanger' });
    const siteAId = siteRes.body.site.id;

    const entryRes = await agentA.post('/api/activity-entries/energie').send({
      siteId: siteAId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    const entryAId = entryRes.body.entry.id;

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send(companyB);

    // B ne doit pas pouvoir créer une entrée sur le site de A, même en
    // devinant son ID.
    const createOnASite = await agentB.post('/api/activity-entries/energie').send({
      siteId: siteAId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 50,
    });
    expect(createOnASite.status).toBe(400);

    // B ne doit voir aucune entrée de A dans sa propre liste.
    const listB = await agentB.get('/api/activity-entries');
    expect(listB.body.entries).toHaveLength(0);

    // B ne doit pas pouvoir supprimer l'entrée de A en devinant son ID.
    const deleteRes = await agentB.delete(`/api/activity-entries/${entryAId}`);
    expect(deleteRes.status).toBe(404);

    // L'entrée de A doit être intacte.
    const listA = await agentA.get('/api/activity-entries');
    expect(listA.body.entries.some((e) => e.id === entryAId)).toBe(true);
  });
});
