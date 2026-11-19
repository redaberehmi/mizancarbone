import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { authGuard } from '../../middleware/authGuard.js';
import { AppError } from '../../middleware/errorHandler.js';
import { handle, parseOr400, idParam } from '../../middleware/route-helpers.js';
import {
  computeMarketBased,
  loadLocationBasedEntries,
  matchEntries,
  findOverAllocatedEntries,
  PURCHASE_INSTRUMENT_TYPES,
  INSTRUMENT_LABELS,
  QUALITY_CRITERIA,
  RESIDUAL_MIX_NOTE,
} from './market-based.service.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');

const contractSchema = z
  .object({
    siteId: z.number().int().positive(),
    instrumentType: z.enum(Object.keys(INSTRUMENT_LABELS)),
    supplier: z.string().trim().max(255).optional(),
    installation: z.string().trim().max(255).optional(),
    technology: z.string().trim().max(128).optional(),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    volumeKwh: z.number().positive().max(1e12),
    factorKgco2ePerKwh: z.number().min(0).max(5).nullable().optional(),
    factorSource: z.string().trim().max(500).optional(),
    documentReference: z.string().trim().max(255).optional(),
    qcConveysAttribute: z.boolean().optional(),
    qcUniqueClaim: z.boolean().optional(),
    qcRetiredOnBehalf: z.boolean().optional(),
    qcVintageCloseToPeriod: z.boolean().optional(),
    qcSameMarket: z.boolean().optional(),
    qcSupplierDeliveredBasis: z.boolean().optional(),
    qcDirectClaimsTransferred: z.boolean().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.periodEnd >= d.periodStart, { message: 'La fin de période doit être postérieure ou égale au début.', path: ['periodEnd'] });

const router = Router();
router.use(authGuard);

router.get(
  '/reference',
  handle(async (_req, res) => {
    res.json({ instrumentLabels: INSTRUMENT_LABELS, qualityCriteria: QUALITY_CRITERIA, residualMixNote: RESIDUAL_MIX_NOTE });
  }),
);

router.get(
  '/market-based',
  handle(async (req, res) => {
    res.json(await computeMarketBased(req.auth.companyId));
  }),
);

router.post(
  '/contracts',
  handle(async (req, res) => {
    const data = parseOr400(contractSchema, req.body);
    const { companyId, userId } = req.auth;
    const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND company_id = $2', [data.siteId, companyId]);
    if (site.rows.length === 0) throw new AppError(400, "Ce site n'existe pas ou n'appartient pas à votre entreprise.");

    if (PURCHASE_INSTRUMENT_TYPES.includes(data.instrumentType)) {
      // Contrôles d'allocation : la consommation du site sur la période doit
      // exister, sans chevauchement partiel, et la somme des volumes des
      // instruments d'achat qui la recouvrent ne peut pas la dépasser.
      const entries = await loadLocationBasedEntries(companyId);
      const candidate = { site_id: data.siteId, period_start: data.periodStart, period_end: data.periodEnd };
      const { contained, partial, consumptionKwh } = matchEntries(candidate, entries);
      if (partial.length > 0) {
        throw new AppError(400, "Une consommation saisie pour ce site chevauche partiellement la période de l'instrument. Alignez la période de l'instrument sur celle des factures (ou scindez les saisies).");
      }
      if (contained.length === 0) {
        throw new AppError(400, "Aucune consommation d'électricité réseau n'est saisie pour ce site sur cette période. Saisissez d'abord la consommation totale : l'instrument en est une allocation.");
      }
      if (data.volumeKwh > consumptionKwh + 1e-6) {
        throw new AppError(400, `Le volume de l'instrument (${data.volumeKwh} kWh) dépasserait la consommation saisie pour ce site et cette période (${consumptionKwh} kWh).`);
      }
      // Contrôle consommation par consommation, au prorata de chaque
      // instrument (un contrat annuel n'est jamais comparé à un seul mois).
      const existing = await pool.query(
        `SELECT site_id, instrument_type, period_start, period_end, volume_kwh FROM electricity_contracts
         WHERE company_id = $1 AND site_id = $2 AND instrument_type = ANY($3)`,
        [companyId, data.siteId, PURCHASE_INSTRUMENT_TYPES],
      );
      const over = findOverAllocatedEntries(
        [...existing.rows, { ...candidate, instrument_type: data.instrumentType, volume_kwh: data.volumeKwh }],
        entries,
      );
      if (over.length > 0) {
        const o = over[0];
        throw new AppError(
          400,
          `La somme des volumes alloués dépasserait la consommation saisie du ${o.periodStart} au ${o.periodEnd} (${Math.round(o.allocatedKwh * 1000) / 1000} kWh alloués pour ${o.kwh} kWh consommés).`,
        );
      }
    }

    const result = await pool.query(
      `INSERT INTO electricity_contracts
         (company_id, site_id, instrument_type, supplier, installation, technology, period_start, period_end, volume_kwh,
          factor_kgco2e_per_kwh, factor_source, document_reference, qc_conveys_attribute, qc_unique_claim,
          qc_retired_on_behalf, qc_vintage_close_to_period, qc_same_market, notes, created_by,
          qc_supplier_delivered_basis, qc_direct_claims_transferred)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [
        companyId,
        data.siteId,
        data.instrumentType,
        data.supplier ?? null,
        data.installation ?? null,
        data.technology ?? null,
        data.periodStart,
        data.periodEnd,
        data.volumeKwh,
        data.factorKgco2ePerKwh ?? null,
        data.factorSource ?? null,
        data.documentReference ?? null,
        data.qcConveysAttribute ?? false,
        data.qcUniqueClaim ?? false,
        data.qcRetiredOnBehalf ?? false,
        data.qcVintageCloseToPeriod ?? false,
        data.qcSameMarket ?? false,
        data.notes ?? null,
        userId,
        data.qcSupplierDeliveredBasis ?? false,
        data.qcDirectClaimsTransferred ?? false,
      ],
    );
    const mb = await computeMarketBased(companyId);
    res.status(201).json({ contract: mb.contracts.find((c) => c.id === result.rows[0].id), marketBased: mb });
  }),
);

router.delete(
  '/contracts/:contractId',
  handle(async (req, res) => {
    const id = idParam(req, 'contractId');
    const result = await pool.query('DELETE FROM electricity_contracts WHERE id = $1 AND company_id = $2 RETURNING id', [id, req.auth.companyId]);
    if (result.rows.length === 0) throw new AppError(404, 'Instrument introuvable.');
    res.status(204).end();
  }),
);

export default router;
