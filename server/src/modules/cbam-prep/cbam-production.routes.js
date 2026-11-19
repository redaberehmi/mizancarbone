import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { authGuard } from '../../middleware/authGuard.js';
import { AppError } from '../../middleware/errorHandler.js';
import { handle, parseOr400, idParam } from '../../middleware/route-helpers.js';
import {
  CBAM_LEGAL_REFERENCES,
  CBAM_REFERENCES_CHECKED_ON,
  CBAM_REFERENCES_SOURCE,
  checkCnCode,
  computeProcess,
  listProcesses,
} from './cbam-production.service.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');

const installationSchema = z.object({
  name: z.string().trim().min(2).max(255),
  siteId: z.number().int().positive().nullable().optional(),
  country: z.string().trim().length(2).optional(),
  address: z.string().trim().max(500).optional(),
});

const processSchema = z
  .object({
    installationId: z.number().int().positive(),
    name: z.string().trim().min(2).max(255),
    productName: z.string().trim().min(2).max(255),
    cnCode: z.string().trim().regex(/^\d{4,10}$/, 'Code NC : 4 à 10 chiffres.'),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    productionTonnes: z.number().positive().max(1e10).nullable().optional(),
    hasPrecursors: z.boolean().optional(),
    producesMultipleGoods: z.boolean().optional(),
    attributionNote: z.string().trim().max(5000).optional(),
  })
  .refine((d) => d.periodEnd >= d.periodStart, { message: 'La fin de période doit être postérieure ou égale au début.', path: ['periodEnd'] });

const linkSchema = z.object({
  activityEntryId: z.number().int().positive(),
  sharePct: z.number().positive().max(100),
});

const router = Router();
router.use(authGuard);

router.get(
  '/reference',
  handle(async (_req, res) => {
    res.json({ legalReferences: CBAM_LEGAL_REFERENCES, checkedOn: CBAM_REFERENCES_CHECKED_ON, source: CBAM_REFERENCES_SOURCE });
  }),
);

router.get(
  '/cn-check',
  handle(async (req, res) => {
    res.json(checkCnCode(req.query.code));
  }),
);

router.get(
  '/installations',
  handle(async (req, res) => {
    const r = await pool.query('SELECT * FROM cbam_installations WHERE company_id = $1 ORDER BY id', [req.auth.companyId]);
    res.json({ installations: r.rows, processes: await listProcesses(req.auth.companyId) });
  }),
);

router.post(
  '/installations',
  handle(async (req, res) => {
    const data = parseOr400(installationSchema, req.body);
    if (data.siteId) {
      const s = await pool.query('SELECT id FROM sites WHERE id = $1 AND company_id = $2', [data.siteId, req.auth.companyId]);
      if (s.rows.length === 0) throw new AppError(400, "Ce site n'existe pas ou n'appartient pas à votre entreprise.");
    }
    const r = await pool.query(
      'INSERT INTO cbam_installations (company_id, site_id, name, country, address) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.auth.companyId, data.siteId ?? null, data.name, (data.country ?? 'MA').toUpperCase(), data.address ?? null],
    );
    res.status(201).json({ installation: r.rows[0] });
  }),
);

router.delete(
  '/installations/:id',
  handle(async (req, res) => {
    const r = await pool.query('DELETE FROM cbam_installations WHERE id = $1 AND company_id = $2 RETURNING id', [idParam(req, 'id'), req.auth.companyId]);
    if (r.rows.length === 0) throw new AppError(404, 'Installation introuvable.');
    res.status(204).end();
  }),
);

router.post(
  '/processes',
  handle(async (req, res) => {
    const data = parseOr400(processSchema, req.body);
    const inst = await pool.query('SELECT id FROM cbam_installations WHERE id = $1 AND company_id = $2', [data.installationId, req.auth.companyId]);
    if (inst.rows.length === 0) throw new AppError(400, 'Installation introuvable.');
    const r = await pool.query(
      `INSERT INTO cbam_production_processes
         (company_id, installation_id, name, product_name, cn_code, period_start, period_end, production_tonnes,
          has_precursors, produces_multiple_goods, attribution_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        req.auth.companyId,
        data.installationId,
        data.name,
        data.productName,
        data.cnCode,
        data.periodStart,
        data.periodEnd,
        data.productionTonnes ?? null,
        data.hasPrecursors ?? false,
        data.producesMultipleGoods ?? false,
        data.attributionNote ?? null,
      ],
    );
    res.status(201).json({ process: await computeProcess(r.rows[0].id, req.auth.companyId) });
  }),
);

router.delete(
  '/processes/:id',
  handle(async (req, res) => {
    const r = await pool.query('DELETE FROM cbam_production_processes WHERE id = $1 AND company_id = $2 RETURNING id', [idParam(req, 'id'), req.auth.companyId]);
    if (r.rows.length === 0) throw new AppError(404, 'Procédé introuvable.');
    res.status(204).end();
  }),
);

router.post(
  '/processes/:id/entries',
  handle(async (req, res) => {
    const processId = idParam(req, 'id');
    const data = parseOr400(linkSchema, req.body);
    const companyId = req.auth.companyId;
    const proc = await pool.query(
      `SELECT p.period_start, p.period_end, i.site_id AS installation_site_id
       FROM cbam_production_processes p JOIN cbam_installations i ON i.id = p.installation_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [processId, companyId],
    );
    if (proc.rows.length === 0) throw new AppError(404, 'Procédé introuvable.');
    const entry = await pool.query(
      `SELECT ae.id, ae.site_id, ae.period_start, ae.period_end, cat.scope, cat.category
       FROM activity_entries ae
       LEFT JOIN LATERAL (SELECT scope, category FROM emission_factors ef WHERE ef.code = ae.factor_code ORDER BY valid_from DESC LIMIT 1) cat ON true
       WHERE ae.id = $1 AND ae.company_id = $2 AND ae.deleted_at IS NULL`,
      [data.activityEntryId, companyId],
    );
    if (entry.rows.length === 0) throw new AppError(404, 'Donnée d’activité introuvable.');
    const e = entry.rows[0];
    if (!(e.scope === 1 || (e.scope === 2 && e.category === 'electricite_location_based'))) {
      throw new AppError(400, "Seules les émissions directes de l'installation (Scope 1) et l'électricité consommée peuvent être rattachées à un procédé CBAM.");
    }
    const p = proc.rows[0];
    if (!p.installation_site_id) {
      throw new AppError(400, "Associez d'abord un site à l'installation : seules les données de ce site peuvent être rattachées à ses procédés.");
    }
    if (e.site_id !== p.installation_site_id) {
      throw new AppError(400, "Cette donnée appartient à un autre site que celui de l'installation : elle ne peut pas être attribuée à ce procédé.");
    }
    if (e.period_start < p.period_start || e.period_end > p.period_end) {
      throw new AppError(400, 'La période de la donnée doit être comprise dans la période du procédé.');
    }
    const used = await pool.query('SELECT COALESCE(SUM(share_pct), 0) AS total FROM cbam_process_entries WHERE activity_entry_id = $1 AND process_id <> $2', [data.activityEntryId, processId]);
    if (Number(used.rows[0].total) + data.sharePct > 100 + 1e-9) {
      throw new AppError(400, `Cette donnée est déjà attribuée à ${used.rows[0].total} % à d'autres procédés : le total ne peut pas dépasser 100 %.`);
    }
    await pool.query(
      `INSERT INTO cbam_process_entries (process_id, activity_entry_id, share_pct) VALUES ($1,$2,$3)
       ON CONFLICT (process_id, activity_entry_id) DO UPDATE SET share_pct = EXCLUDED.share_pct`,
      [processId, data.activityEntryId, data.sharePct],
    );
    res.status(201).json({ process: await computeProcess(processId, companyId) });
  }),
);

router.delete(
  '/processes/:id/entries/:entryId',
  handle(async (req, res) => {
    const processId = idParam(req, 'id');
    const proc = await pool.query('SELECT id FROM cbam_production_processes WHERE id = $1 AND company_id = $2', [processId, req.auth.companyId]);
    if (proc.rows.length === 0) throw new AppError(404, 'Procédé introuvable.');
    await pool.query('DELETE FROM cbam_process_entries WHERE process_id = $1 AND activity_entry_id = $2', [processId, idParam(req, 'entryId')]);
    res.json({ process: await computeProcess(processId, req.auth.companyId) });
  }),
);

export default router;
