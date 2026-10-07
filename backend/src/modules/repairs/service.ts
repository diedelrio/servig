import { Prisma, type RepairStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { env } from '../../lib/env.js';
import { sendEmail } from '../../lib/email.js';
import { HttpError } from '../../lib/http.js';
import { repairReceivedMail } from '../../lib/emailTemplates.js';
import { sniff } from '../../lib/fileType.js';
import * as storage from '../../lib/storage.js';
import { toolView } from '../customers/service.js';
import { allowedFor } from './workflow.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_REPAIR = 30;

/** REP-AAAA-NNNNNN. El INSERT ... ON CONFLICT DO NOTHING + UPDATE evita fallos por carrera dentro de la transacción. */
async function nextNumber(tx: Prisma.TransactionClient) {
  const year = new Date().getFullYear();
  const key = `REP-${year}`;
  await tx.counter.createMany({ data: [{ key, value: 0 }], skipDuplicates: true });
  const c = await tx.counter.update({ where: { key }, data: { value: { increment: 1 } } });
  return `${key}-${String(c.value).padStart(6, '0')}`;
}

type CreateInput = {
  toolId: number; declaredFault: string; visualState: string; accessories?: string; notes?: string
  inWarranty: boolean; requiresQuote: boolean
}

export async function createRepair(userId: number, i: CreateInput) {
  const tool = await prisma.tool.findUnique({ where: { id: i.toolId }, include: { customer: true } });
  if (!tool) throw new HttpError(404, 'Herramienta no encontrada');

  const repair = await prisma.$transaction(async (tx) => {
    const r = await tx.repair.create({
      data: {
        number: await nextNumber(tx),
        customerId: tool.customerId, // el cliente siempre es el dueño de la herramienta
        toolId: tool.id,
        declaredFault: i.declaredFault,
        visualState: i.visualState,
        accessories: i.accessories || null,
        notes: i.notes || null,
        inWarranty: i.inWarranty,
        requiresQuote: i.requiresQuote,
        receivedById: userId,
      },
    });
    await tx.repairStatusHistory.create({ data: { repairId: r.id, fromStatus: null, toStatus: 'RECIBIDO', userId, comment: 'Recepción', origin: 'STAFF' } });
    return r;
  });

  await audit('REPAIR_CREATED', 'Repair', repair.id, userId, { number: repair.number, toolId: tool.id, customerId: tool.customerId });
  if (tool.customer.email) {
    await sendEmail({
      to: tool.customer.email, type: 'REPAIR_RECEIVED', entity: 'Repair', entityId: String(repair.id),
      ...repairReceivedMail(tool.customer.name, { number: repair.number, tool: `${tool.brand} ${tool.model}`, fault: i.declaredFault }),
    });
  }
  return repair;
}

export async function listRepairs(q: { status?: string; search?: string; customerId?: number }) {
  const where: Prisma.RepairWhereInput = {};
  if (q.status) where.status = q.status as RepairStatus;
  if (q.customerId) where.customerId = q.customerId;
  if (q.search) {
    const contains = { contains: q.search, mode: 'insensitive' as const };
    where.OR = [
      { number: contains },
      { customer: { name: contains } },
      { tool: { OR: [{ brand: contains }, { model: contains }, { serialNumber: contains }, { type: contains }] } },
    ];
  }
  const rows = await prisma.repair.findMany({
    where, orderBy: { receivedAt: 'desc' }, take: 200,
    include: { customer: { select: { id: true, name: true } }, tool: { select: { type: true, brand: true, model: true } } },
  });
  return rows;
}

export async function getRepair(id: number, role: string) {
  const r = await prisma.repair.findUnique({
    where: { id },
    include: {
      customer: true,
      tool: true,
      receivedBy: { select: { firstName: true, lastName: true } },
      history: { orderBy: { createdAt: 'asc' }, include: { user: { select: { firstName: true, lastName: true } } } },
      attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, filename: true, mime: true, size: true, createdAt: true } },
    },
  });
  if (!r) throw new HttpError(404, 'Reparación no encontrada');
  return { ...r, tool: toolView(r.tool), business: env.business, allowedTransitions: allowedFor(r, role) };
}

const safeName = (n: string) => n.replace(/[\\/\0\r\n]/g, '_').slice(0, 150) || 'archivo';

export async function addAttachment(userId: number, repairId: number, filename: string, data: Buffer) {
  if (!(await prisma.repair.findUnique({ where: { id: repairId }, select: { id: true } }))) throw new HttpError(404, 'Reparación no encontrada');
  if (!data.length) throw new HttpError(400, 'Archivo vacío');
  if (data.length > MAX_FILE_BYTES) throw new HttpError(413, 'El archivo supera el máximo de 10 MB');
  const type = sniff(data);
  if (!type) throw new HttpError(415, 'Formato no permitido (solo JPG, PNG, WebP o PDF)');
  if ((await prisma.attachment.count({ where: { repairId } })) >= MAX_FILES_PER_REPAIR) throw new HttpError(409, 'Límite de adjuntos alcanzado');

  const storageKey = await storage.save(data, type.ext);
  const a = await prisma.attachment.create({
    data: { repairId, filename: safeName(filename), storageKey, mime: type.mime, size: data.length, uploadedById: userId },
    select: { id: true, filename: true, mime: true, size: true, createdAt: true },
  });
  await audit('ATTACHMENT_ADDED', 'Repair', repairId, userId, { attachmentId: a.id, mime: a.mime, size: a.size });
  return a;
}

export async function getAttachment(repairId: number, id: number) {
  const a = await prisma.attachment.findFirst({ where: { id, repairId } });
  if (!a) throw new HttpError(404, 'Adjunto no encontrado');
  return { meta: a, stream: storage.read(a.storageKey) };
}
