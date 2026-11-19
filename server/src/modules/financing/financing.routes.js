import { Router } from 'express';
import { z } from 'zod';
import * as controller from './financing.controller.js';
import { authGuard } from '../../middleware/authGuard.js';
import { handle, parseOr400 } from '../../middleware/route-helpers.js';
import { simulateCarbonCost, CARBON_COST_DISCLAIMER, REGULATORY_STATUS } from './carbon-cost.service.js';

const router = Router();

router.use(authGuard);

router.get('/programs', controller.listPrograms);
router.get('/carbon-tax/parameters', controller.getCarbonTaxParameters);
router.get('/carbon-tax/simulate', controller.simulateCarbonTax);

const carbonCostSchema = z.object({
  pricePerTco2e: z.number().min(0).max(100000),
  currency: z.enum(['MAD', 'EUR', 'USD']),
  scopes: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).min(1),
  year: z.number().int().min(2000).max(2100),
  scope2Method: z.enum(['location', 'market']).default('location'),
});

router.get('/carbon-cost/status', handle(async (_req, res) => res.json({ disclaimer: CARBON_COST_DISCLAIMER, regulatoryStatus: REGULATORY_STATUS })));

router.post(
  '/carbon-cost/simulate',
  handle(async (req, res) => {
    const data = parseOr400(carbonCostSchema, req.body);
    res.json(await simulateCarbonCost(req.auth.companyId, { ...data, scopes: [...new Set(data.scopes)].sort() }));
  }),
);

export default router;
