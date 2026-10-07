import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';

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

/** Lee rol y permisos de la BD en cada petición: deshabilitar o cambiar de rol surte efecto de inmediato. */
export const requirePermission = (...codes: string[]) => async (req: Request, _res: Response, next: NextFunction) => {
  const u = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!u || u.status !== 'ACTIVE') throw new HttpError(401, 'Sesión inválida o expirada');
  const have = new Set(u.role.permissions.map((p) => p.permission.code));
  if (!codes.every((c) => have.has(c))) throw new HttpError(403, 'Sin permiso');
  next();
};
