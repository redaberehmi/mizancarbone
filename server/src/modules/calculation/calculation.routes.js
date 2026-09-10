import { Router } from 'express';
import * as controller from './calculation.controller.js';
import { authGuard } from '../../middleware/authGuard.js';

const router = Router();

router.use(authGuard);

router.post('/run', controller.runCalculation);
router.get('/summary', controller.getSummary);
router.get('/scope3/readiness', controller.getScope3Readiness);
router.post('/scope3/estimate', controller.estimateScope3);
router.get('/scope3', controller.listScope3Estimates);

export default router;
