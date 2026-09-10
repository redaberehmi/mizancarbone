import { Router } from 'express';
import * as controller from './reports.controller.js';
import { authGuard } from '../../middleware/authGuard.js';

const router = Router();

router.use(authGuard);

router.get('/export.csv', controller.exportCsv);
router.get('/export.pdf', controller.exportPdf);
router.get('/dashboard-analytics', controller.getDashboardAnalyticsRoute);

export default router;
