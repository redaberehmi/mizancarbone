import { Router } from 'express';
import multer from 'multer';
import * as controller from './activity-entries.controller.js';
import { authGuard } from '../../middleware/authGuard.js';

// Stockage en mémoire (pas d'écriture disque du fichier uploadé), taille
// plafonnée — exigence section 7.9. Le type réel est vérifié séparément par
// ses octets dans le controller (assertImportFile), pas ici.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.use(authGuard);

router.get('/factors', controller.listFactors);
router.get('/import/template', controller.importTemplate);
router.post('/import', upload.single('file'), controller.importFile);

router.get('/', controller.listEntries);
router.post('/energie', controller.createEnergyEntry);
router.post('/matieres-premieres', controller.createRawMaterialEntry);
router.delete('/:entryId', controller.deleteEntry);
router.patch('/:entryId/product-allocation', controller.updateProductAllocation);

export default router;
