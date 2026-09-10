import { Router } from 'express';
import * as companiesController from './companies.controller.js';
import { authGuard } from '../../middleware/authGuard.js';

const router = Router();

router.use(authGuard);

router.get('/me', companiesController.getProfile);
router.put('/me', companiesController.updateProfile);

router.get('/me/sites', companiesController.listSites);
router.post('/me/sites', companiesController.createSite);
router.put('/me/sites/:siteId', companiesController.updateSite);
router.delete('/me/sites/:siteId', companiesController.deleteSite);

export default router;
