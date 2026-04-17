/**
 * Rate limiter: 60 req/min por usuário autenticado (ou por IP como fallback).
 * Requirements: 2.6
 */

import rateLimit from 'express-rate-limit';
import { ENV } from '../config/env.js';

export const rateLimiter = rateLimit({
  windowMs: ENV.RATE_LIMIT_WINDOW_MS,
  max: ENV.RATE_LIMIT_MAX,
  keyGenerator: (req) => req.user?.email || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Limite de requisições excedido. Tente novamente em 1 minuto.',
  },
  skip: (req) => req.path === '/health',
});
