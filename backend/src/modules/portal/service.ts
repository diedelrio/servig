import { prisma } from '../../lib/prisma.js';
import { getBusiness } from '../../lib/settings.js';
import { HttpError } from '../../lib/http.js';
import * as storage from '../../lib/storage.js';
import { expireDueQuotes } from '../quotes/service.js';
import { decideQuote } from '../quotes/approval.js';
import { audit } from '../../lib/audit.js';
import { sendEmail } from '../../lib/email.js';
import { repairRequestedMail } from '../../lib/emailTemplates.js';
import { createTool, listTools } from '../customers/service.js';
import { nextNumber } from '../repairs/service.js';
import { transitionRepair } from '../repairs/workflow.js';

/**
 * Todo el portal consulta SIEMPRE filtrando por el cliente de la sesión. Un id ajeno responde 404 (igual que uno inexistente),
 * así no se revela qué reparaciones existen. Aquí no sale nada interno: ni diagnósticos privados, ni comentarios del historial,
 * ni nombres del personal, ni costes.
 */
const ACTIVE_HIDDEN = ['ENTREGADO', 'CANCELADO'];
const PARTS_VISIBLE_FROM = ['PRESUPUESTO_APROBADO', 'PEDIDO_REPUESTOS_MARCA', 'EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR', 'ENTREGADO'];

async function ownRepair(customerId: number, id: number) {
  const r = await prisma.repair.findFirst({ where: { id, customerId } });
  if (!r) throw new HttpError(404, 'Reparación no encontrada');
  return r;
}

export async function listRepairs(customerId: number) {
  await expireDueQuotes();
  const rows = await prisma.repair.findMany({
    where: { customerId },
    orderBy: { receivedAt: 'desc' },
    include: { tool: { select: { type: true, brand: true, model: true } }, quote: { include: { versions: { select: { version: true, status: true } } } } },
  });
  return rows.map((r) => {
    const cur = r.quote?.versions.find((v) => v.version === r.quote!.currentVersion);
    return {
      id: r.id, number: r.number, status: r.status, receivedAt: r.receivedAt, tool: r.tool,
      active: !ACTIVE_HIDDEN.includes(r.status),
      pendingQuote: r.status === 'PRESUPUESTO_PENDIENTE_APROBACION' && cur?.status === 'ENVIADO',
    };
  });
}

export async function getRepair(customerId: number, id: number) {
  await expireDueQuotes();
  const r = await prisma.repair.findFirst({
    where: { id, customerId },
    include: {
      customer: true,
      tool: true,
      history: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } },
      diagnoses: { where: { visibleToCustomer: true }, orderBy: { createdAt: 'asc' }, select: { text: true, createdAt: true } },
      attachments: { where: { visibleToCustomer: true }, orderBy: { createdAt: 'asc' }, select: { id: true, filename: true, mime: true, size: true, createdAt: true } },
      spareParts: { where: { status: { not: 'CANCELADO' } }, orderBy: { id: 'asc' }, select: { description: true, quantity: true, status: true } },
      quote: { include: { versions: { include: { items: { orderBy: { position: 'asc' } }, approval: true } } } },
    },
  });
  if (!r) throw new HttpError(404, 'Reparación no encontrada');

  // Solo la versión vigente y solo si ya se envió; un borrador o una versión retirada no existen para el cliente.
  const cur = r.quote?.versions.find((v) => v.version === r.quote!.currentVersion);
  const visible = cur && ['ENVIADO', 'APROBADO', 'RECHAZADO', 'VENCIDO'].includes(cur.status) ? cur : null;
  const canDecide = !!visible && visible.status === 'ENVIADO' && r.status === 'PRESUPUESTO_PENDIENTE_APROBACION' && !!visible.validUntil && visible.validUntil > new Date();

  return {
    id: r.id, number: r.number, status: r.status, receivedAt: r.receivedAt,
    tool: { type: r.tool.type, brand: r.tool.brand, model: r.tool.model, serialNumber: r.tool.serialNumber },
    declaredFault: r.declaredFault, inWarranty: r.inWarranty,
    timeline: r.history.map((h) => ({ status: h.toStatus, at: h.createdAt })),
    diagnoses: r.diagnoses,
    quote: visible && {
      version: visible.version, status: visible.status, notes: visible.notes, validUntil: visible.validUntil, canDecide,
      subtotal: visible.subtotal.toFixed(2), taxTotal: visible.taxTotal.toFixed(2), total: visible.total.toFixed(2),
      items: visible.items.map((i) => ({
        type: i.type, description: i.description, quantity: i.quantity.toFixed(2), unitPrice: i.unitPrice.toFixed(2),
        taxRate: i.taxRate.toFixed(2), lineNet: i.lineNet.toFixed(2),
      })),
      decision: visible.approval ? { decision: visible.approval.decision, decidedAt: visible.approval.decidedAt } : null,
    },
    spareParts: PARTS_VISIBLE_FROM.includes(r.status) ? r.spareParts : [],
    attachments: r.attachments,
    // Datos del resguardo, sin el nombre de quien lo recibió.
    receipt: {
      business: await getBusiness(), customer: { name: r.customer.name, taxId: r.customer.taxId },
      visualState: r.visualState, accessories: r.accessories, notes: r.notes, warrantyExpiresAt: r.tool.warrantyExpiresAt?.toISOString().slice(0, 10) ?? null,
    },
  };
}

export async function getAttachment(customerId: number, repairId: number, attId: number) {
  await ownRepair(customerId, repairId);
  const a = await prisma.attachment.findFirst({ where: { id: attId, repairId, visibleToCustomer: true } });
  if (!a) throw new HttpError(404, 'Documento no encontrado');
  return { meta: a, stream: await storage.read(a.storageKey) };
}

/** Decisión desde el portal: mismo núcleo que el enlace, con el usuario autenticado y origen CUSTOMER_PORTAL. */
export async function decide(
  customerId: number, userId: number, repairId: number,
  decision: 'APPROVE' | 'REJECT', meta: { comment?: string; ip?: string; userAgent?: string },
) {
  const r = await prisma.repair.findFirst({ where: { id: repairId, customerId }, include: { quote: { include: { versions: true } } } });
  if (!r) throw new HttpError(404, 'Reparación no encontrada');
  const cur = r.quote?.versions.find((v) => v.version === r.quote!.currentVersion);
  if (!cur) throw new HttpError(404, 'No hay un presupuesto para responder');
  return decideQuote({ versionId: cur.id, decision, origin: 'CUSTOMER_PORTAL', userId, ...meta });
}

// ---------- Pedidos nuevos del cliente ----------

/** Herramientas del propio cliente (para elegir sobre cuál pide la reparación). */
export async function myTools(customerId: number) {
  return (await listTools({ customerId })).map((t) => ({ id: t.id, type: t.type, brand: t.brand, model: t.model, serialNumber: t.serialNumber }));
}

/** El cliente da de alta una herramienta suya (con el catálogo o con texto libre). Siempre queda a su nombre. */
export async function addMyTool(userId: number, customerId: number, input: Record<string, unknown>) {
  const t = await createTool(userId, { ...input, customerId });
  return { id: t.id, type: t.type, brand: t.brand, model: t.model, serialNumber: t.serialNumber };
}

/**
 * Pedido de reparación hecho por el propio cliente. Entra como SOLICITADA (la herramienta aún no está en el taller) y siempre
 * requiere presupuesto: omitirlo (RN-02) solo lo decide el personal al recibirla. El taller la pasa a «Recibido» al recibir el equipo.
 */
export async function requestRepair(userId: number, customerId: number, i: { toolId: number; declaredFault: string; notes?: string }) {
  const tool = await prisma.tool.findFirst({ where: { id: i.toolId, customerId }, include: { customer: true } });
  if (!tool) throw new HttpError(404, 'Herramienta no encontrada'); // una ajena responde igual que una inexistente
  const repair = await prisma.$transaction(async (tx) => {
    const r = await tx.repair.create({
      data: {
        number: await nextNumber(tx), customerId, toolId: tool.id, declaredFault: i.declaredFault,
        visualState: 'Pendiente de registrar al recibir la herramienta', notes: i.notes || null,
        status: 'SOLICITADA', inWarranty: false, requiresQuote: true, receivedById: userId,
      },
    });
    await tx.repairStatusHistory.create({ data: { repairId: r.id, fromStatus: null, toStatus: 'SOLICITADA', userId, comment: 'Solicitud del cliente', origin: 'CUSTOMER_PORTAL' } });
    return r;
  });
  await audit('REPAIR_REQUESTED', 'Repair', repair.id, userId, { number: repair.number, toolId: tool.id, customerId });
  if (tool.customer.email) {
    await sendEmail({
      to: tool.customer.email, type: 'REPAIR_REQUESTED', entity: 'Repair', entityId: String(repair.id),
      ...repairRequestedMail(tool.customer.name, { number: repair.number, tool: `${tool.brand} ${tool.model}`, fault: i.declaredFault }),
    });
  }
  return { id: repair.id, number: repair.number, status: repair.status };
}

/** El cliente puede retirar su solicitud mientras el taller no haya recibido la herramienta. */
export async function cancelRequest(userId: number, customerId: number, id: number) {
  await ownRepair(customerId, id);
  await transitionRepair({ repairId: id, to: 'CANCELADO', actor: { userId, role: null, origin: 'CUSTOMER_PORTAL' }, comment: 'Cancelada por el cliente' });
  return { id, status: 'CANCELADO' };
}
