import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { sendEmail } from '../../lib/email.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http.js';
import { DUMMY_HASH, days, hashPassword, hashToken, minutes, newToken, verifyPassword } from '../../lib/security.js';
import { passwordChangedMail, resetPasswordMail, verifyEmailMail } from '../../lib/emailTemplates.js';
import { signAccess } from '../../middleware/auth.js';

const COOLDOWN_MS = 60_000;
const since = () => new Date(Date.now() - COOLDOWN_MS);
const INVALID_LINK = new HttpError(400, 'Enlace inválido o vencido', 'INVALID_TOKEN');

type U = { id: number; email: string; firstName: string };

async function sendVerification(user: U) {
  await prisma.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  const token = newToken();
  await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: minutes(24 * 60) } });
  await sendEmail({ to: user.email, type: 'AUTH_VERIFY_EMAIL', entity: 'User', entityId: String(user.id), ...verifyEmailMail(user.firstName, token) });
}

type RegisterInput = { firstName: string; lastName: string; email: string; password: string };

/** Siempre responde igual al llamador: no revela si el email ya existe. */
export async function register(i: RegisterInput, ip?: string) {
  if (await prisma.user.findUnique({ where: { email: i.email } })) return;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CLIENTE' } });
  const passwordHash = await hashPassword(i.password);
  let user;
  try {
    user = await prisma.user.create({
      data: { email: i.email, firstName: i.firstName, lastName: i.lastName, passwordHash, roleId: role.id },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // carrera: ya existe
    throw e;
  }
  await audit('REGISTER', 'User', user.id, user.id, undefined, ip);
  await sendVerification(user);
}

export async function verifyEmail(token: string) {
  const h = hashToken(token);
  const userId = await prisma.$transaction(async (tx) => {
    // Consumo atómico: solo una petición puede marcar el token como usado.
    const r = await tx.emailVerificationToken.updateMany({
      where: { tokenHash: h, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (r.count === 0) throw INVALID_LINK;
    const t = await tx.emailVerificationToken.findUniqueOrThrow({ where: { tokenHash: h } });
    await tx.user.updateMany({
      where: { id: t.userId, status: 'PENDING_EMAIL_VERIFICATION' },
      data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    return t.userId;
  });
  await audit('EMAIL_VERIFIED', 'User', userId, userId);
}

export async function resendVerification(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'PENDING_EMAIL_VERIFICATION') return;
  if (await prisma.emailVerificationToken.findFirst({ where: { userId: user.id, createdAt: { gt: since() } } })) return;
  await sendVerification(user);
}

async function issueSession(user: { id: number; role: { name: string } }) {
  const refresh = newToken();
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: hashToken(refresh), expiresAt: days(7) } });
  return { accessToken: signAccess({ id: user.id, role: user.role.name }), refresh };
}

const publicUser = (u: { id: number; email: string; firstName: string; lastName: string; role: { name: string } }) => ({
  id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role.name,
});

export async function login(email: string, password: string, ip?: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  // Se verifica siempre un hash para que el tiempo no delate si el usuario existe.
  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
  if (!user || !ok || user.status === 'DISABLED') throw new HttpError(401, 'Credenciales inválidas');
  if (user.status === 'PENDING_EMAIL_VERIFICATION') {
    throw new HttpError(403, 'Debes confirmar tu email antes de iniciar sesión', 'EMAIL_NOT_VERIFIED');
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit('LOGIN', 'User', user.id, user.id, undefined, ip);
  return { ...(await issueSession(user)), user: publicUser(user) };
}

export async function refresh(raw: string | undefined) {
  if (!raw) throw new HttpError(401, 'No autenticado');
  const rec = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: { include: { role: true } } } });
  if (!rec) throw new HttpError(401, 'No autenticado');
  if (rec.revokedAt) {
    // Reutilización de un token ya rotado: posible robo, se cierran todas las sesiones.
    await prisma.refreshToken.updateMany({ where: { userId: rec.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw new HttpError(401, 'No autenticado');
  }
  if (rec.expiresAt < new Date() || rec.user.status !== 'ACTIVE') throw new HttpError(401, 'No autenticado');
  const r = await prisma.refreshToken.updateMany({ where: { id: rec.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count === 0) throw new HttpError(401, 'No autenticado');
  return { ...(await issueSession(rec.user)), user: publicUser(rec.user) };
}

export async function logout(raw: string | undefined) {
  if (!raw) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(raw), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function me(id: number) {
  const u = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!u || u.status !== 'ACTIVE') throw new HttpError(401, 'No autenticado');
  return publicUser(u);
}

/** Respuesta idéntica exista o no el usuario. */
export async function forgotPassword(email: string, ip?: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') return;
  if (await prisma.passwordResetToken.findFirst({ where: { userId: user.id, createdAt: { gt: since() } } })) return;
  await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  const token = newToken();
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: minutes(60) } });
  await audit('PASSWORD_RESET_REQUESTED', 'User', user.id, user.id, undefined, ip);
  await sendEmail({ to: user.email, type: 'AUTH_PASSWORD_RESET', entity: 'User', entityId: String(user.id), ...resetPasswordMail(user.firstName, token) });
}

export async function resetPassword(token: string, password: string, ip?: string) {
  const h = hashToken(token);
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const r = await tx.passwordResetToken.updateMany({
      where: { tokenHash: h, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (r.count === 0) throw INVALID_LINK;
    const t = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: h } });
    const u = await tx.user.update({ where: { id: t.userId }, data: { passwordHash, passwordChangedAt: new Date() } });
    await tx.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return u;
  });
  await audit('PASSWORD_CHANGED', 'User', user.id, user.id, undefined, ip);
  await sendEmail({ to: user.email, type: 'AUTH_PASSWORD_CHANGED', entity: 'User', entityId: String(user.id), ...passwordChangedMail(user.firstName) });
}
