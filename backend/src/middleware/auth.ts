import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http.js';

export type AuthUser = { id: number; role: string };
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const signAccess = (u: AuthUser) => jwt.sign({ role: u.role }, env.jwtSecret, { subject: String(u.id), expiresIn: '15m' });

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'No autenticado');
  try {
    const p = jwt.verify(h.slice(7), env.jwtSecret) as jwt.JwtPayload;
    req.user = { id: Number(p.sub), role: p.role };
    next();
  } catch {
    throw new HttpError(401, 'Sesión inválida o expirada');
  }
}

export const requireRole = (...roles: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) throw new HttpError(403, 'Sin permiso');
  next();
};
