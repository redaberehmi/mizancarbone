import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';

const company = {
  companyName: 'Metal Forge SA',
  sector: 'metallurgie',
  email: 'contact@metalforge.ma',
  password: 'mot-de-passe-solide-123',
};

let agent;
let siteId;

beforeEach(async () => {
  await resetDatabase();
  agent = request.agent(app);
  await agent.post('/api/auth/register').send(company);
  const siteRes = await agent.post('/api/companies/me/sites').send({ name: 'Site Tanger', city: 'Tanger' });
  siteId = siteRes.body.site.id;
});

afterAll(async () => {
  await closeDatabase();
});

describe('GET /api/activity-entries/factors', () => {
  it('renvoie les facteurs disponibles en saisie directe, jamais scope3_ratio', async () => {
    const res = await agent.get('/api/activity-entries/factors');
    expect(res.status).toBe(200);
    expect(res.body.factors.length).toBeGreaterThan(0);
    expect(res.body.factors.every((f) => f.category !== 'scope3_ratio')).toBe(true);
    expect(res.body.factors.some((f) => f.code === 'diesel_L')).toBe(true);
  });
});

describe('POST /api/activity-entries/energie', () => {
  it('crée une entrée énergie valide', async () => {
    const res = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 150.5,
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.factor_code).toBe('diesel_L');
  });

  it('refuse un factor_code inconnu', async () => {
    const res = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'code_qui_nexiste_pas',
      quantity: 10,
    });
    expect(res.status).toBe(400);
  });

  it('refuse un site appartenant à une autre entreprise', async () => {
    const res = await agent.post('/api/activity-entries/energie').send({
      siteId: siteId + 9999,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 10,
    });
    expect(res.status).toBe(400);
  });

  it('refuse period_end < period_start', async () => {
    const res = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-02-01',
      periodEnd: '2024-01-01',
      factorCode: 'diesel_L',
      quantity: 10,
    });
    expect(res.status).toBe(400);
  });

  it('refuse une quantité négative ou nulle', async () => {
    const res = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 0,
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/activity-entries/matieres-premieres', () => {
  it('crée une entrée matière première avec le code sentinelle', async () => {
    const res = await agent.post('/api/activity-entries/matieres-premieres').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      materialLabel: 'Bobines acier (tonnes)',
      quantity: 12,
      supplier: 'Sonasid',
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.factor_code).toBe('matiere_premiere_non_calculee');
    expect(res.body.entry.material_label).toBe('Bobines acier (tonnes)');
    expect(res.body.entry.supplier).toBe('Sonasid');
  });
});

describe('GET /api/activity-entries + DELETE', () => {
  it('liste puis soft-delete une entrée (elle disparaît de la liste et ne revient pas)', async () => {
    const createRes = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 42,
    });
    const entryId = createRes.body.entry.id;

    const listBefore = await agent.get('/api/activity-entries');
    expect(listBefore.body.entries.some((e) => e.id === entryId)).toBe(true);

    const delRes = await agent.delete(`/api/activity-entries/${entryId}`);
    expect(delRes.status).toBe(204);

    const listAfter = await agent.get('/api/activity-entries');
    expect(listAfter.body.entries.some((e) => e.id === entryId)).toBe(false);

    // Deuxième suppression : déjà supprimée -> 404 (pas de double soft-delete silencieux)
    const delAgain = await agent.delete(`/api/activity-entries/${entryId}`);
    expect(delAgain.status).toBe(404);
  });
});

describe('POST /api/activity-entries/import', () => {
  it('importe un CSV valide (energie + matiere_premiere)', async () => {
    const csv = [
      'site,type,code_facteur,description_matiere,fournisseur,periode_debut,periode_fin,quantite,document_source',
      `${'Site Tanger'},energie,diesel_L,,,2024-01-01,2024-01-31,100,facture-janvier.pdf`,
      `${'Site Tanger'},matiere_premiere,,Bobines acier,Sonasid,2024-01-01,2024-01-31,5,`,
    ].join('\n');

    const res = await agent
      .post('/api/activity-entries/import')
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'import.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);

    const list = await agent.get('/api/activity-entries');
    expect(list.body.entries.length).toBe(2);
  });

  it("n'importe rien et rapporte les erreurs ligne par ligne sur un CSV invalide", async () => {
    const csv = [
      'site,type,code_facteur,description_matiere,fournisseur,periode_debut,periode_fin,quantite,document_source',
      'Site Inconnu,energie,diesel_L,,,2024-01-01,2024-01-31,100,',
      `${'Site Tanger'},energie,code_bidon,,,2024-01-01,2024-01-31,-5,`,
    ].join('\n');

    const res = await agent
      .post('/api/activity-entries/import')
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'import.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThan(0);

    const list = await agent.get('/api/activity-entries');
    expect(list.body.entries.length).toBe(0);
  });

  it('rejette un fichier binaire déguisé en .csv (vérification par contenu réel)', async () => {
    // Signature PNG : un vrai fichier binaire, pas un CSV, malgré l'extension.
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

    const res = await agent
      .post('/api/activity-entries/import')
      .attach('file', fakePng, { filename: 'donnees.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
  });
});
