import { registerSchema, loginSchema } from './auth.validation.js';
import * as authService from './auth.service.js';
import { issueAuthCookie, clearAuthCookie } from '../../middleware/authGuard.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function register(req, res, next) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Données invalides.', parsed.error.flatten());
    }

    const { company, user } = await authService.registerCompanyAndUser(parsed.data);
    issueAuthCookie(res, { userId: user.id, companyId: company.id });

    res.status(201).json({
      company,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Données invalides.', parsed.error.flatten());
    }

    const { userId, companyId, email } = await authService.authenticate(parsed.data);
    issueAuthCookie(res, { userId, companyId });

    res.json({ user: { id: userId, email }, companyId });
  } catch (err) {
    next(err);
  }
}

export function logout(req, res) {
  clearAuthCookie(res);
  res.status(204).end();
}

export async function me(req, res, next) {
  try {
    const data = await authService.getUserWithCompany(req.auth.userId, req.auth.companyId);
    res.json({
      user: { id: data.user_id, email: data.email, lastLoginAt: data.last_login_at },
      company: {
        id: data.company_id,
        name: data.name,
        sector: data.sector,
        headcount: data.headcount,
        baseYear: data.base_year,
      },
    });
  } catch (err) {
    next(err);
  }
}
