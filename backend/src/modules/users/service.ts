import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { sendEmail } from '../../lib/email.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http.js';
import { hashPassword, hashToken, minutes, newToken } from '../../lib/security.js';
import { inviteMail } from '../../lib/emailTemplates.js';

type UserRow = Prisma.UserGetPayload<{ include: { role: true } }>;

const view = (u: UserRow) => ({
  id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName,
  role: u.role.name, status: u.status, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
});

export async function list(q: { search?: string; role?: string; status?: string }) {
  const where: Prisma.UserWhereInput = {};
  if (q.search) {
    where.OR = ['email', 'firstName', 'lastName'].map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' } }));
  }
  if (q.role) where.role = { name: q.role };
  if (q.status) where.status = q.status as Prisma.UserWhereInput['status'];
  const users = await prisma.user.findMany({ where, include: { role: true }, orderBy: { createdAt: 'desc' }, take: 200 });
  return users.map(view);
}

async function sendInvite(user: { id: number; email: string; firstName: string }, roleName: string) {
  await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  const token = newToken();
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: minutes(72 * 60) } });
  await sendEmail({ to: user.email, type: 'AUTH_INVITE', entity: 'User', entityId: String(user.id), ...inviteMail(user.firstName, roleName, token) });
}

/** El usuario nace sin contraseña utilizable: la define con el enlace de invitación. */
export async function create(adminId: number, i: { firstName: string; lastName: string; email: string; role: string }) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: i.role } });
  const passwordHash = await hashPassword(newToken());
  let user;
  try {
    user = await prisma.user.create({
      data: { email: i.email, firstName: i.firstName, lastName: i.lastName, roleId: role.id, passwordHash },
      include: { role: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new HttpError(409, 'Ya existe un usuario con ese email');
    throw e;
  }
  await audit('USER_CREATED', 'User', user.id, adminId, { role: i.role });
  await sendInvite(user, role.name);
  return view(user);
}

export async function update(adminId: number, id: number, i: { role?: string; status?: 'ACTIVE' | 'DISABLED' }) {
  // Evita que un ADMIN se quite a sí mismo el acceso.
  if (id === adminId) throw new HttpError(409, 'No puedes cambiar tu propio rol o estado');
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  const data: Prisma.UserUpdateInput = {};
  if (i.role) data.role = { connect: { name: i.role } };
  if (i.status === 'DISABLED') data.status = 'DISABLED';
  if (i.status === 'ACTIVE') {
    if (user.status === 'PENDING_EMAIL_VERIFICATION') throw new HttpError(409, 'La cuenta aún no confirmó su email');
    data.status = user.emailVerifiedAt ? 'ACTIVE' : 'PENDING_EMAIL_VERIFICATION';
  }
  const updated = await prisma.user.update({ where: { id }, data, include: { role: true } });
  if (i.status === 'DISABLED') {
    await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  await audit('USER_UPDATED', 'User', id, adminId, {
    from: { role: user.role.name, status: user.status },
    to: { role: updated.role.name, status: updated.status },
  });
  return view(updated);
}

/** Para invitaciones vencidas: el usuario pendiente no puede usar "olvidé mi contraseña". */
export async function resendInvite(adminId: number, id: number) {
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new HttpError(404, 'Usuario no encontrado');
  if (user.status !== 'PENDING_EMAIL_VERIFICATION') throw new HttpError(409, 'La cuenta ya está activada');
  await sendInvite(user, user.role.name);
  await audit('USER_INVITE_RESENT', 'User', id, adminId);
}
