import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { retryEmail } from '../../lib/email.js';
import { HttpError } from '../../lib/http.js';

const MAX_PAGE = 200;
const pageSize = (v?: number) => Math.min(Math.max(v ?? 50, 1), MAX_PAGE);

export type AuditQuery = { entity?: string; entityId?: string; action?: string; userId?: number; from?: string; to?: string; before?: number; limit?: number }

/** Auditoría, de lo más nuevo a lo más viejo, paginada por cursor (`before` = id del último ítem de la página anterior). */
export async function listAudit(q: AuditQuery) {
  const where: Prisma.AuditLogWhereInput = {};
  if (q.entity) where.entity = q.entity;
  if (q.entityId) where.entityId = q.entityId;
  if (q.action) where.action = q.action;
  if (q.userId) where.userId = q.userId;
  if (q.before) where.id = { lt: q.before };
  if (q.from || q.to) {
    where.createdAt = {
      ...(q.from ? { gte: new Date(q.from + 'T00:00:00Z') } : {}),
      ...(q.to ? { lt: new Date(new Date(q.to + 'T00:00:00Z').getTime() + 86_400_000) } : {}), // incluye todo el día "to"
    };
  }
  const take = pageSize(q.limit);
  const rows = await prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: take + 1 });
  const more = rows.length > take;
  const items = rows.slice(0, take);

  const ids = [...new Set(items.map((r) => r.userId).filter((x): x is number => x != null))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, firstName: true, lastName: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    items: items.map((r) => ({ ...r, user: r.userId ? byId.get(r.userId) ?? null : null })),
    nextCursor: more ? items[items.length - 1].id : null,
  };
}

/** Acciones distintas que existen, para poblar el filtro. */
export async function auditActions() {
  const rows = await prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
  return rows.map((r) => r.action);
}

export type EmailQuery = { status?: string; type?: string; to?: string; before?: number; limit?: number }

export async function listEmailLogs(q: EmailQuery) {
  const where: Prisma.EmailLogWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.type) where.type = q.type;
  if (q.to) where.to = { contains: q.to, mode: 'insensitive' };
  if (q.before) where.id = { lt: q.before };
  const take = pageSize(q.limit);
  const rows = await prisma.emailLog.findMany({ where, orderBy: { id: 'desc' }, take: take + 1 });
  const more = rows.length > take;
  const items = rows.slice(0, take).map(({ html, ...r }) => ({ ...r, canRetry: r.status === 'FAILED' && html != null })); // el cuerpo nunca sale por la API
  return { items, nextCursor: more ? items[items.length - 1].id : null, failed: await prisma.emailLog.count({ where: { status: 'FAILED' } }) };
}

export async function retryManually(adminId: number, id: number) {
  const r = await retryEmail(id);
  if (r === 'NOT_FOUND') throw new HttpError(404, 'Registro no encontrado');
  if (r === 'NOT_FAILED') throw new HttpError(409, 'Solo se reintentan los correos fallidos', 'NOT_FAILED');
  if (r === 'NO_BODY') {
    throw new HttpError(409, 'Este correo llevaba un enlace de un solo uso y no se conserva: la persona debe volver a solicitarlo', 'NO_BODY');
  }
  await audit('EMAIL_RETRIED', 'EmailLog', id, adminId, { result: r });
  return { id, result: r };
}
