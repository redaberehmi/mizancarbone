import { Router } from 'express';
import * as controller from './cbam-prep.controller.js';
import { authGuard } from '../../middleware/authGuard.js';

const router = Router();

router.use(authGuard);

router.get('/relevance', controller.getRelevance);
router.get('/products', controller.getProducts);
router.get('/summary', controller.getSummary);
router.get('/export.csv', controller.exportCsv);
router.get('/export.pdf', controller.exportPdf);

export default router;
