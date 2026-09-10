import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, resetDatabase, closeDatabase } from './helpers/testApp.js';
import { pool } from '../src/config/db.js';

// Découpe une ligne CSV en respectant les guillemets (certains champs, ex.
// "Matière première (traçabilité, non calculé)", contiennent une virgule
// littérale à l'intérieur d'une cellule quotée) — un simple split(',') la
// couperait au mauvais endroit et décalerait tous les index de colonne.
function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

const metallurgieCompany = {
  companyName: 'Metal Forge SA',
  sector: 'metallurgie',
  email: 'contact@metalforge.ma',
  password: 'mot-de-passe-solide-123',
};

const automobileCompany = {
  companyName: 'AutoParts Maroc SA',
  sector: 'automobile',
  email: 'contact@autoparts.ma',
  password: 'mot-de-passe-solide-123',
};

let agent;
let siteId;

beforeEach(async () => {
  await resetDatabase();
  agent = request.agent(app);
  await agent.post('/api/auth/register').send(metallurgieCompany);
  const siteRes = await agent.post('/api/companies/me/sites').send({ name: 'Site Tanger', city: 'Tanger' });
  siteId = siteRes.body.site.id;
});

afterAll(async () => {
  await closeDatabase();
});

describe('GET /api/cbam-prep/relevance', () => {
  it('indique le secteur métallurgie comme couvert', async () => {
    const res = await agent.get('/api/cbam-prep/relevance');
    expect(res.status).toBe(200);
    expect(res.body.sector).toBe('metallurgie');
    expect(res.body.isCoveredSector).toBe(true);
    expect(res.body.officialCategories).toContain('Fer et acier');
  });

  it('indique un autre secteur comme non couvert (mais reste accessible)', async () => {
    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send(automobileCompany);
    const res = await agentB.get('/api/cbam-prep/relevance');
    expect(res.status).toBe(200);
    expect(res.body.isCoveredSector).toBe(false);
  });

  // Les 6 catégories officielles CBAM (CBAM_OFFICIAL_CATEGORIES) ont été
  // ajoutées comme secteurs à part entière — chacune doit être couverte,
  // pas seulement 'metallurgie' comme avant cet ajout.
  it.each(['fer_et_acier', 'aluminium', 'ciment', 'engrais', 'electricite', 'hydrogene'])(
    "indique le secteur %s (catégorie officielle CBAM) comme couvert",
    async (sector) => {
      const agentSector = request.agent(app);
      await agentSector.post('/api/auth/register').send({
        companyName: `Entreprise ${sector} SA`,
        sector,
        email: `${sector}@test.ma`,
        password: 'mot-de-passe-solide-123',
      });
      const res = await agentSector.get('/api/cbam-prep/relevance');
      expect(res.status).toBe(200);
      expect(res.body.sector).toBe(sector);
      expect(res.body.isCoveredSector).toBe(true);
    },
  );

  it.each(['textile', 'agroalimentaire'])(
    "indique le secteur d'origine %s comme non couvert (inchangé après l'ajout des secteurs CBAM)",
    async (sector) => {
      const agentSector = request.agent(app);
      await agentSector.post('/api/auth/register').send({
        companyName: `Entreprise ${sector} SA`,
        sector,
        email: `${sector}@test.ma`,
        password: 'mot-de-passe-solide-123',
      });
      const res = await agentSector.get('/api/cbam-prep/relevance');
      expect(res.status).toBe(200);
      expect(res.body.isCoveredSector).toBe(false);
    },
  );
});

describe('PATCH /api/activity-entries/:id/product-allocation', () => {
  it('assigne un produit à une entrée énergie', async () => {
    const entryRes = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    const entryId = entryRes.body.entry.id;

    const res = await agent
      .patch(`/api/activity-entries/${entryId}/product-allocation`)
      .send({ productAllocation: 'Bobines acier laminé' });
    expect(res.status).toBe(200);
    expect(res.body.entry.product_allocation).toBe('Bobines acier laminé');
  });

  it('efface un produit avec null', async () => {
    const entryRes = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    const entryId = entryRes.body.entry.id;
    await agent.patch(`/api/activity-entries/${entryId}/product-allocation`).send({ productAllocation: 'Produit A' });

    const res = await agent.patch(`/api/activity-entries/${entryId}/product-allocation`).send({ productAllocation: null });
    expect(res.status).toBe(200);
    expect(res.body.entry.product_allocation).toBeNull();
  });

  it("refuse (404) de modifier l'entrée d'une autre entreprise (scopé company_id, section 7.1)", async () => {
    const entryRes = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    const entryId = entryRes.body.entry.id;

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send(automobileCompany);

    const res = await agentB
      .patch(`/api/activity-entries/${entryId}/product-allocation`)
      .send({ productAllocation: 'Tentative de piratage' });
    expect(res.status).toBe(404);

    const stillA = await agent.get('/api/activity-entries');
    expect(stillA.body.entries[0].product_allocation).toBeNull();
  });

  it('refuse une chaîne vide (utiliser null pour effacer)', async () => {
    const entryRes = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    const res = await agent
      .patch(`/api/activity-entries/${entryRes.body.entry.id}/product-allocation`)
      .send({ productAllocation: '' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/cbam-prep/summary', () => {
  it('distingue les lignes matière première (tco2e null) des lignes énergie (tco2e calculé)', async () => {
    const energyRes = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    await agent
      .patch(`/api/activity-entries/${energyRes.body.entry.id}/product-allocation`)
      .send({ productAllocation: 'Bobines acier' });

    const materialRes = await agent.post('/api/activity-entries/matieres-premieres').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      materialLabel: 'Ferraille',
      quantity: 12,
      supplier: 'Sonasid',
    });
    await agent
      .patch(`/api/activity-entries/${materialRes.body.entry.id}/product-allocation`)
      .send({ productAllocation: 'Bobines acier' });

    const res = await agent.get('/api/cbam-prep/summary');
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);

    const group = res.body.groups[0];
    expect(group.product).toBe('Bobines acier');
    expect(group.energieCount).toBe(1);
    expect(group.matierePremiereCount).toBe(1);
    expect(group.energieTco2eTotal).toBeCloseTo((100 * 2.68) / 1000, 6);

    const energyEntry = group.entries.find((e) => e.kind === 'energie');
    const materialEntry = group.entries.find((e) => e.kind === 'matiere_premiere');
    expect(energyEntry.tco2e).toBeCloseTo((100 * 2.68) / 1000, 6);
    expect(materialEntry.tco2e).toBeNull();
  });

  it('regroupe les entrées non allouées sous product: null', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    const res = await agent.get('/api/cbam-prep/summary');
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].product).toBeNull();
  });

  it("exclut les estimations Scope 3 (pas liées à un produit physique)", async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });

    // Active réellement une estimation Scope 3 pour prouver l'exclusion,
    // pas juste vérifier l'absence d'un mot-clé qui n'apparaîtrait de toute
    // façon jamais.
    await pool.query(
      `INSERT INTO emission_factors (code, label, scope, category, unit, value_kgco2e, source, is_national, region, valid_from)
       VALUES ('scope3_ratio_metallurgie', 'Ratio test', 3, 'scope3_ratio', 'k€', 200, 'Test ADEME', false, 'MA', '2024-01-01')`,
    );
    await pool.query(
      `INSERT INTO exchange_rates (base_currency, quote_currency, rate, source, valid_from)
       VALUES ('EUR', 'MAD', 10, 'Test rate', '2024-01-01')`,
    );
    const estimateRes = await agent.post('/api/calculations/scope3/estimate').send({
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
      amountMad: 100000,
    });
    expect(estimateRes.status).toBe(201);

    const res = await agent.get('/api/cbam-prep/summary');
    // Une seule entrée (l'énergie) : l'estimation Scope 3 n'apparaît pas.
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].kind).toBe('energie');

    await pool.query(`DELETE FROM activity_entries WHERE factor_code LIKE 'scope3_ratio_%'`);
    await pool.query(`DELETE FROM emission_factors WHERE source = 'Test ADEME'`);
    await pool.query(`DELETE FROM exchange_rates WHERE source = 'Test rate'`);
  });
});

describe('GET /api/cbam-prep/export.csv', () => {
  it('inclut la note méthodologique et une valeur vide (pas "0") pour la matière première', async () => {
    await agent.post('/api/activity-entries/matieres-premieres').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      materialLabel: 'Ferraille',
      quantity: 12,
      supplier: 'Sonasid',
    });

    const res = await agent.get('/api/cbam-prep/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('non calculé');
    expect(res.text).toContain('Ferraille');

    const lines = res.text.split('\n');
    const dataLine = lines.find((l) => l.includes('Ferraille'));
    const cells = parseCsvLine(dataLine);
    const tco2eCell = cells[9]; // colonne tco2e
    expect(tco2eCell).toBe(''); // jamais "0"
  });
});

describe('GET /api/cbam-prep/export.pdf', () => {
  it('renvoie une réponse PDF (statut, en-têtes, nom de fichier jamais "declaration")', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });

    // supertest/superagent ne restitue pas fidèlement un corps binaire via
    // res.body sans configuration avancée du parseur — on vérifie donc les
    // en-têtes ici, et les octets réels du PDF plus bas via le service
    // directement (build-level, sans cet obstacle de couche HTTP).
    const res = await agent.get('/api/cbam-prep/export.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/donnees-preparation-cbam-.*\.pdf/);
    expect(res.headers['content-disposition'].toLowerCase()).not.toContain('declaration');
  }, 15000);

  it('produit un buffer PDF valide (magic bytes %PDF)', async () => {
    await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });

    const companyRes = await agent.get('/api/companies/me');
    const { buildPdfExport } = await import('../src/modules/cbam-prep/cbam-prep.service.js');
    const { buffer, filename } = await buildPdfExport(companyRes.body.company.id);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(filename).not.toContain('declaration');
  }, 15000);
});

describe('Isolation multi-tenant — préparation CBAM', () => {
  it("empêche l'entreprise B de voir les produits/le résumé de l'entreprise A — même quand B a ses propres données", async () => {
    // Preuve plus solide qu'une simple liste vide côté B : les DEUX
    // entreprises ont leurs propres données allouées à un produit, et
    // chacune ne doit voir QUE les siennes, dans les deux sens.
    const energyResA = await agent.post('/api/activity-entries/energie').send({
      siteId,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'diesel_L',
      quantity: 100,
    });
    await agent
      .patch(`/api/activity-entries/${energyResA.body.entry.id}/product-allocation`)
      .send({ productAllocation: 'Bobines acier confidentielles A' });

    const agentB = request.agent(app);
    await agentB.post('/api/auth/register').send(automobileCompany);
    const siteResB = await agentB.post('/api/companies/me/sites').send({ name: 'Site Casablanca', city: 'Casablanca' });
    const energyResB = await agentB.post('/api/activity-entries/energie').send({
      siteId: siteResB.body.site.id,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
      factorCode: 'gasoline_L',
      quantity: 50,
    });
    await agentB
      .patch(`/api/activity-entries/${energyResB.body.entry.id}/product-allocation`)
      .send({ productAllocation: 'Pare-chocs confidentiels B' });

    const productsA = await agent.get('/api/cbam-prep/products');
    expect(productsA.body.products).toEqual(['Bobines acier confidentielles A']);

    const productsB = await agentB.get('/api/cbam-prep/products');
    expect(productsB.body.products).toEqual(['Pare-chocs confidentiels B']);

    const summaryA = await agent.get('/api/cbam-prep/summary');
    expect(summaryA.body.groups).toHaveLength(1);
    expect(summaryA.body.groups[0].product).toBe('Bobines acier confidentielles A');

    const summaryB = await agentB.get('/api/cbam-prep/summary');
    expect(summaryB.body.groups).toHaveLength(1);
    expect(summaryB.body.groups[0].product).toBe('Pare-chocs confidentiels B');
  });

  it('rejette /api/cbam-prep/summary sans authentification', async () => {
    const res = await request(app).get('/api/cbam-prep/summary');
    expect(res.status).toBe(401);
  });
});
