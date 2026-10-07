import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

// Token en claro solo viaja por email; en BD se guarda su SHA-256.
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export const hashPassword = (p: string) => argon2.hash(p, { type: argon2.argon2id });
export const verifyPassword = (hash: string, p: string) => argon2.verify(hash, p).catch(() => false);

// Hash de relleno para igualar tiempos cuando el usuario no existe (evita enumeración por timing).
export const DUMMY_HASH = await argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });

export const minutes = (n: number) => new Date(Date.now() + n * 60_000);
export const days = (n: number) => minutes(n * 1440);
