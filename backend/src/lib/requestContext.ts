import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/** Contexto de la petición en curso, para que la auditoría registre la IP sin tener que pasarla por todas las capas. */
const store = new AsyncLocalStorage<{ ip?: string }>();

export const requestContext = (req: Request, _res: Response, next: NextFunction) => store.run({ ip: req.ip }, next);
export const currentIp = () => store.getStore()?.ip;
