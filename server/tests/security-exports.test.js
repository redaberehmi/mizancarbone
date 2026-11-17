import http from 'node:http';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';

// On capture le HTML envoyé au moteur PDF pour vérifier l'échappement, sans
// lancer Chrome pour ces tests. La vraie fonction reste testée plus bas
// (vi.importActual) pour le durcissement réseau/JavaScript.
let capturedHtml = null;
vi.mock('../src/modules/reports/pdf-template.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    htmlToPdfBuffer: vi.fn(async (html) => {
      capturedHtml = html;
      return Buffer.from('%PDF-test');
    }),
  };
});

const { app, resetDatabase, closeDatabase } = await import('./helpers/testApp.js');
const { csvEscape } = await import('../src/modules/reports/csv-escape.js');

const company = {
  companyName: 'Metal Forge SA',
  sector: 'metallurgie',
  email: 'contact@metalforge.ma',
  password: 'mot-de-passe-solide-123',
};

const MALICIOUS_SITE = '<script>fetch("http://169.254.169.254/")</script><img src=x>';

let agent;

beforeEach(async () => {
  capturedHtml = null;
  await resetDatabase();
  agent = request.agent(app);
  await agent.post('/api/auth/register').send(company);
});

afterAll(async () => {
  await closeDatabase();
});

async function addEntryOnSite(siteName) {
  const siteRes = await agent.post('/api/companies/me/sites').send({ name: siteName, city: 'Tanger' });
  expect(siteRes.status).toBe(201);
  const entryRes = await agent.post('/api/activity-entries/energie').send({
    siteId: siteRes.body.site.id,
    periodStart: '2024-01-01',
    periodEnd: '2024-01-31',
    factorCode: 'diesel_L',
    quantity: 100,
  });
  expect(entryRes.status).toBe(201);
}

describe('Export PDF CBAM — échappement HTML', () => {
  it('échappe le nom du site : aucune balise injectée ne parvient au moteur PDF', async () => {
    await addEntryOnSite(MALICIOUS_SITE);
    const res = await agent.get('/api/cbam-prep/export.pdf');
    expect(res.status).toBe(200);
    expect(capturedHtml).toBeTruthy();
    expect(capturedHtml).not.toContain('<script>fetch');
    expect(capturedHtml).not.toContain('<img src=x>');
    expect(capturedHtml).toContain('&lt;script&gt;');
  });

  it('le rapport carbone échappe aussi le nom du site', async () => {
    await addEntryOnSite(MALICIOUS_SITE);
    const res = await agent.get('/api/reports/export.pdf');
    expect(res.status).toBe(200);
    expect(capturedHtml).not.toContain('<script>fetch');
    expect(capturedHtml).toContain('&lt;script&gt;');
  });
});

describe('Exports CSV — injection de formules', () => {
  it('csvEscape neutralise = + - @ mais laisse les nombres intacts', () => {
    expect(csvEscape('=1+1')).toBe("'=1+1");
    expect(csvEscape('+33 6')).toBe("'+33 6");
    expect(csvEscape('-cmd')).toBe("'-cmd");
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvEscape('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(csvEscape('-12.5')).toBe('-12.5');
    expect(csvEscape(-3)).toBe('-3');
    expect(csvEscape(0.268)).toBe('0.268');
    expect(csvEscape('Site Tanger')).toBe('Site Tanger');
    expect(csvEscape(null)).toBe('');
  });

  it('les deux exports CSV neutralisent un nom de site commençant par =', async () => {
    await addEntryOnSite('=1+1');
    const cbam = await agent.get('/api/cbam-prep/export.csv');
    expect(cbam.status).toBe(200);
    expect(cbam.text).toContain("'=1+1");
    expect(cbam.text).not.toMatch(/(^|,)=1\+1/m);

    const raw = await agent.get('/api/reports/export.csv');
    expect(raw.status).toBe(200);
    expect(raw.text).toContain("'=1+1");
    expect(raw.text).not.toMatch(/(^|,)=1\+1/m);
  });
});

describe('Moteur PDF — durcissement', () => {
  it('ne laisse sortir aucune requête réseau et n’exécute aucun script', async () => {
    const { htmlToPdfBuffer } = await vi.importActual('../src/modules/reports/pdf-template.js');
    let hits = 0;
    const server = http.createServer((req, res) => { hits += 1; res.end('x'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const html = `<html><body><h1>Test</h1>
        <img src="http://127.0.0.1:${port}/img">
        <link rel="stylesheet" href="http://127.0.0.1:${port}/css">
        <script>fetch("http://127.0.0.1:${port}/js")</script></body></html>`;
      const pdf = await htmlToPdfBuffer(html);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  }, 60000);
});
