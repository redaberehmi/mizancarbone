import * as service from './financing.service.js';

export async function listPrograms(req, res, next) {
  try {
    const programs = await service.listActiveFinancingPrograms();
    res.json({ programs });
  } catch (err) {
    next(err);
  }
}

export async function getCarbonTaxParameters(req, res, next) {
  try {
    const status = await service.getCarbonTaxParametersStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
}

export async function simulateCarbonTax(req, res, next) {
  try {
    const result = await service.simulateCarbonTax(req.auth.companyId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
