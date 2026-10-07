import { rateLimit } from 'express-rate-limit';
import { env } from './env.js';

/** Límite por IP en una ventana de `windowMin` minutos. Desactivado en los tests. */
export const limit = (max: number, windowMin: number) =>
  rateLimit({
    windowMs: windowMin * 60_000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.isTest,
    message: { error: 'Demasiados intentos, inténtalo más tarde' },
  });
