import type { Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from './env.js';

/**
 * Límite en una ventana de windowMin minutos. Por IP por defecto; key permite limitar por otra cosa (p. ej. el email
 * que se intenta, para frenar la fuerza bruta distribuida contra una cuenta). Desactivado en los tests.
 */
export const limit = (max: number, windowMin: number, opts: { key?: (req: Request) => string; skipSuccessful?: boolean } = {}) =>
  rateLimit({
    windowMs: windowMin * 60_000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.isTest,
    skipSuccessfulRequests: opts.skipSuccessful,
    ...(opts.key ? { keyGenerator: opts.key, validate: { keyGeneratorIpFallback: false } } : {}),
    message: { error: 'Demasiados intentos, inténtalo más tarde' },
  });
