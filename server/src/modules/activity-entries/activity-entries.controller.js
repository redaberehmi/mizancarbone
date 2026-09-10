import {
  energyEntrySchema,
  rawMaterialEntrySchema,
  listEntriesQuerySchema,
  productAllocationSchema,
} from './activity-entries.validation.js';
import * as service from './activity-entries.service.js';
import {
  parseAndValidateImport,
  insertImportedRows,
  assertImportFile,
  IMPORT_TEMPLATE_HEADERS,
} from './activity-entries.import.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function listFactors(req, res, next) {
  try {
    const factors = await service.listAvailableFactors();
    res.json({ factors });
  } catch (err) {
    next(err);
  }
}

export async function createEnergyEntry(req, res, next) {
  try {
    const parsed = energyEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Données invalides.', parsed.error.flatten());
    }
    const entry = await service.createEnergyEntry(req.auth.companyId, req.auth.userId, parsed.data);
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function createRawMaterialEntry(req, res, next) {
  try {
    const parsed = rawMaterialEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Données invalides.', parsed.error.flatten());
    }
    const entry = await service.createRawMaterialEntry(req.auth.companyId, req.auth.userId, parsed.data);
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function listEntries(req, res, next) {
  try {
    const parsed = listEntriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, 'Filtres invalides.', parsed.error.flatten());
    }
    const entries = await service.listEntries(req.auth.companyId, parsed.data);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
}

export async function deleteEntry(req, res, next) {
  try {
    await service.softDeleteEntry(req.auth.companyId, Number(req.params.entryId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function updateProductAllocation(req, res, next) {
  try {
    const parsed = productAllocationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Données invalides.', parsed.error.flatten());
    }
    const entry = await service.setProductAllocation(
      req.auth.companyId,
      Number(req.params.entryId),
      parsed.data.productAllocation,
    );
    res.json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function importFile(req, res, next) {
  try {
    await assertImportFile(req.file);

    const { rows, errors } = await parseAndValidateImport(req.file.buffer, req.auth.companyId);

    if (errors.length > 0) {
      // "details" et non "rowErrors" au niveau racine : c'est le contrat
      // suivi partout ailleurs dans l'API (voir AppError / errorHandler.js),
      // et c'est ce que le client frontend (ApiError.details) lit déjà.
      return res.status(400).json({
        error: `${errors.length} ligne(s) invalide(s) — aucune donnée importée.`,
        details: errors,
      });
    }

    const imported = await insertImportedRows(
      req.auth.companyId,
      req.auth.userId,
      rows,
      req.file.originalname,
    );

    res.status(201).json({ imported });
  } catch (err) {
    next(err);
  }
}

export function importTemplate(req, res) {
  const csv = `${IMPORT_TEMPLATE_HEADERS.join(',')}\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modele-import-mizancarbone.csv"');
  res.send(csv);
}
