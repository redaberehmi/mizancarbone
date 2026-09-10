import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authGuard } from '../../middleware/authGuard.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.post('/logout', authGuard, authController.logout);
router.get('/me', authGuard, authController.me);

export default router;
