import { Router } from 'express';
import * as controller from './financing.controller.js';
import { authGuard } from '../../middleware/authGuard.js';

const router = Router();

router.use(authGuard);

router.get('/programs', controller.listPrograms);
router.get('/carbon-tax/parameters', controller.getCarbonTaxParameters);
router.get('/carbon-tax/simulate', controller.simulateCarbonTax);

export default router;
