import { scope3EstimateSchema } from './calculation.validation.js';
import * as service from './calculation.service.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function runCalculation(req, res, next) {
  try {
    const summary = await service.runScopeOneTwoCalculation(req.auth.companyId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
}

export async function getSummary(req, res, next) {
  try {
    const summary = await service.getEmissionsSummary(req.auth.companyId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
}

export async function getScope3Readiness(req, res, next) {
  try {
    const readiness = await service.getScope3Readiness(req.auth.companyId);
    res.json(readiness);
  } catch (err) {
    next(err);
  }
}

export async function estimateScope3(req, res, next) {
  try {
    const parsed = scope3EstimateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Données invalides.', parsed.error.flatten());
    }
    const result = await service.estimateScope3(req.auth.companyId, req.auth.userId, parsed.data);
    res.status(201).json({ result });
  } catch (err) {
    next(err);
  }
}

export async function listScope3Estimates(req, res, next) {
  try {
    const estimates = await service.listScope3Estimates(req.auth.companyId);
    res.json({ estimates });
  } catch (err) {
    next(err);
  }
}
