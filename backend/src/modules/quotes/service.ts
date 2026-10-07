import { Prisma, type QuoteStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { getNumber, quoteConfig } from '../../lib/settings.js';
import { sendEmail } from '../../lib/email.js';
import { HttpError } from '../../lib/http.js';
import { computeTotals } from '../../lib/money.js';
import { quoteAvailableMail } from '../../lib/emailTemplates.js';
import { transitionRepair } from '../repairs/workflow.js';
import { approvalUrl, issueLink } from './approval.js';

type ItemInput = { type: 'LABOR' | 'PART' | 'OTHER'; description: string; quantity: number; unitPrice: number; taxRate?: number };
type ResolvedItem = ItemInput & { taxRate: number };

const versionInclude = { items: { orderBy: { position: 'asc' } }, approval: true } as const satisfies Prisma.QuoteVersionInclude;
type VersionRow = Prisma.QuoteVersionGetPayload<{ include: typeof versionInclude }>;

const money = (d: Prisma.Decimal) => d.toFixed(2);
const versionView = (v: VersionRow) => ({
  id: v.id, version: v.version, status: v.status, notes: v.notes, sentAt: v.sentAt, validUntil: v.validUntil, createdAt: v.createdAt,
  subtotal: money(v.subtotal), taxTotal: money(v.taxTotal), total: money(v.total),
  approval: v.approval
    ? { decision: v.approval.decision, decidedAt: v.approval.decidedAt, origin: v.approval.origin, ip: v.approval.ip, comment: v.approval.comment }
    : null,
  items: v.items.map((i) => ({
    id: i.id, type: i.type, description: i.description, quantity: i.quantity.toFixed(2), unitPrice: money(i.unitPrice),
    taxRate: i.taxRate.toFixed(2), lineNet: money(i.lineNet), lineTax: money(i.lineTax),
  })),
});

/** Marca como VENCIDO lo enviado cuya validez pasó. Se llama al leer, al operar y periódicamente. */
export const expireDueQuotes = async () =>
  (await prisma.quoteVersion.updateMany({ where: { status: 'ENVIADO', validUntil: { lt: new Date() } }, data: { status: 'VENCIDO' } })).count;

const config = async () => {
  const { defaultTaxRate, validDays } = await quoteConfig();
  return { defaultTaxRate, validDays };
};

async function loadRepair(id: number) {
  const r = await prisma.repair.findUnique({ where: { id }, include: { customer: true, tool: true } });
  if (!r) throw new HttpError(404, 'Reparación no encontrada');
  return r;
}

async function loadQuote(repairId: number) {
  return prisma.quote.findUnique({ where: { repairId }, include: { versions: { orderBy: { version: 'asc' }, include: versionInclude } } });
}

function currentOf<T extends { version: number }>(q: { currentVersion: number; versions: T[] }) {
  return q.versions.find((v) => v.version === q.currentVersion)!;
}

export async function getQuote(repairId: number) {
  await loadRepair(repairId);
  await expireDueQuotes();
  const q = await loadQuote(repairId);
  if (!q) return { quote: null, ...(await config()) };
  const cur = currentOf(q);
  return { quote: { id: q.id, repairId, currentVersion: q.currentVersion, status: cur.status, versions: q.versions.map(versionView) }, ...(await config()) };
}

const requireReview = (status: string) => {
  if (status !== 'EN_REVISION') throw new HttpError(409, 'La reparación debe estar en revisión para preparar el presupuesto', 'NOT_IN_REVIEW');
};

// Las columnas son Decimal(12,2): por encima se desbordaría la base de datos (y daría un 500).
const MAX_TOTAL = new Prisma.Decimal('9999999999.99');

const itemRows = (items: ResolvedItem[]) => {
  const t = computeTotals(items);
  if (t.subtotal.gt(MAX_TOTAL) || t.taxTotal.gt(MAX_TOTAL) || t.total.gt(MAX_TOTAL)) {
    throw new HttpError(400, 'El importe total del presupuesto es demasiado grande', 'AMOUNT_TOO_LARGE');
  }
  return {
    totals: { subtotal: t.subtotal, taxTotal: t.taxTotal, total: t.total },
    rows: items.map((i, idx) => ({
      position: idx, type: i.type, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate,
      lineNet: t.lines[idx].lineNet, lineTax: t.lines[idx].lineTax,
    })),
  };
};

/** Crea el presupuesto (v1 borrador) o reemplaza las líneas del borrador vigente. */
export async function saveDraft(userId: number, repairId: number, input: { items: ItemInput[]; notes?: string }) {
  const repair = await loadRepair(repairId);
  requireReview(repair.status);
  const defaultTax = await getNumber('quote.defaultTaxRate');
  const { totals, rows } = itemRows(input.items.map((i) => ({ ...i, taxRate: i.taxRate ?? defaultTax })));
  const notes = input.notes || null;

  const created = await prisma.$transaction(async (tx) => {
    let quote = await tx.quote.findUnique({ where: { repairId }, include: { versions: true } });
    let isNew = false;
    if (!quote) {
      isNew = true;
      quote = await tx.quote.create({
        data: { repairId, versions: { create: { version: 1, createdById: userId } } },
        include: { versions: true },
      });
    }
    const cur = currentOf(quote);
    if (cur.status !== 'BORRADOR') throw new HttpError(409, 'El presupuesto ya fue enviado: crea una nueva versión para modificarlo', 'QUOTE_LOCKED');
    // Bloquea la fila condicionada a BORRADOR: si send() la congela en este instante, o ganamos nosotros (y send() congela lo que
    // dejamos) o perdemos y fallamos aquí. Sin esto se podían reescribir las líneas de una versión ya enviada.
    const lock = await tx.quoteVersion.updateMany({ where: { id: cur.id, status: 'BORRADOR' }, data: { notes } });
    if (lock.count === 0) throw new HttpError(409, 'El presupuesto ya fue enviado: crea una nueva versión para modificarlo', 'QUOTE_LOCKED');
    await tx.quoteItem.deleteMany({ where: { versionId: cur.id } });
    await tx.quoteItem.createMany({ data: rows.map((r) => ({ ...r, versionId: cur.id })) });
    await tx.quoteVersion.update({ where: { id: cur.id }, data: { ...totals, notes } });
    return { isNew, version: cur.version };
  });
  await audit(created.isNew ? 'QUOTE_CREATED' : 'QUOTE_UPDATED', 'Repair', repairId, userId, { version: created.version, total: money(totals.total) });
  return getQuote(repairId);
}

/** Tras un rechazo, retiro o vencimiento: nueva versión borrador copiando las líneas de la anterior. */
export async function newVersion(userId: number, repairId: number) {
  const repair = await loadRepair(repairId);
  requireReview(repair.status);
  await expireDueQuotes();
  const version = await prisma.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({ where: { repairId }, include: { versions: { include: versionInclude } } });
    if (!quote) throw new HttpError(404, 'Aún no hay presupuesto');
    const cur = currentOf(quote);
    const reusable: QuoteStatus[] = ['RECHAZADO', 'CANCELADO', 'VENCIDO'];
    if (!reusable.includes(cur.status)) throw new HttpError(409, 'La versión vigente sigue en curso: no se puede crear otra', 'VERSION_IN_PROGRESS');
    const next = cur.version + 1;
    await tx.quoteVersion.create({
      data: {
        quoteId: quote.id, version: next, createdById: userId, notes: cur.notes,
        subtotal: cur.subtotal, taxTotal: cur.taxTotal, total: cur.total,
        items: { create: cur.items.map(({ id: _id, versionId: _v, ...rest }) => rest) },
      },
    });
    await tx.quote.update({ where: { id: quote.id }, data: { currentVersion: next } });
    return next;
  });
  await audit('QUOTE_VERSION_CREATED', 'Repair', repairId, userId, { version });
  return getQuote(repairId);
}

/** Congela la versión, pasa la reparación a "pendiente de aprobación" y avisa al cliente: todo o nada. */
export async function send(userId: number, role: string, repairId: number) {
  const repair = await loadRepair(repairId);
  const quote = await loadQuote(repairId);
  if (!quote) throw new HttpError(404, 'Aún no hay presupuesto');
  const cur = currentOf(quote);
  if (cur.status !== 'BORRADOR') throw new HttpError(409, 'Esta versión ya fue enviada', 'QUOTE_LOCKED');
  // Solo el cliente puede aprobar (enlace o portal), y ambos dependen de su email: sin él, el presupuesto no tendría salida.
  if (!repair.customer.email) {
    throw new HttpError(409, 'El cliente no tiene email: cárgalo en su ficha antes de enviar el presupuesto', 'CUSTOMER_EMAIL_REQUIRED');
  }
  if (!cur.items.length) throw new HttpError(400, 'Agrega al menos un concepto antes de enviar', 'EMPTY_QUOTE');

  const sentAt = new Date();
  const validUntil = new Date(sentAt.getTime() + (await getNumber('quote.validDays')) * 86_400_000);

  let token = '';
  await transitionRepair({
    repairId, to: 'PRESUPUESTO_PENDIENTE_APROBACION', internal: true,
    actor: { userId, role, origin: 'STAFF' },
    comment: `Presupuesto v${cur.version} enviado`,
    inTx: async (tx) => {
      // Condicionado al estado: un doble clic no envía dos veces.
      const r = await tx.quoteVersion.updateMany({ where: { id: cur.id, status: 'BORRADOR' }, data: { status: 'ENVIADO', sentAt, validUntil, sentById: userId } });
      if (r.count === 0) throw new HttpError(409, 'Esta versión ya fue enviada', 'QUOTE_LOCKED');
      token = await issueLink(tx, cur.id, validUntil);
    },
  });
  // Lo que quedó congelado es lo que se comunica (pudo cambiar entre la primera lectura y la transacción).
  const frozen = await prisma.quoteVersion.findUniqueOrThrow({ where: { id: cur.id } });
  await audit('QUOTE_SENT', 'Repair', repairId, userId, { version: cur.version, total: money(frozen.total), validUntil });

  await sendEmail({
    to: repair.customer.email, type: 'QUOTE_AVAILABLE', entity: 'Repair', entityId: String(repairId),
    ...quoteAvailableMail(repair.customer.name, {
      number: repair.number, tool: `${repair.tool.brand} ${repair.tool.model}`, total: money(frozen.total), validUntil, approvalUrl: approvalUrl(token),
    }),
  });
  return getQuote(repairId);
}

/** Corregir un presupuesto enviado que el cliente aún no decidió (o que venció): se cancela esa versión. */
export async function withdraw(userId: number, role: string, repairId: number, comment: string) {
  await loadRepair(repairId);
  await expireDueQuotes();
  const quote = await loadQuote(repairId);
  if (!quote) throw new HttpError(404, 'Aún no hay presupuesto');
  const cur = currentOf(quote);
  if (cur.status !== 'ENVIADO' && cur.status !== 'VENCIDO') throw new HttpError(409, 'No hay un presupuesto enviado para retirar', 'NOTHING_TO_WITHDRAW');

  await transitionRepair({
    repairId, to: 'EN_REVISION', internal: true, comment: `Presupuesto v${cur.version} retirado: ${comment}`,
    actor: { userId, role, origin: 'STAFF' },
    inTx: async (tx) => {
      const r = await tx.quoteVersion.updateMany({ where: { id: cur.id, status: { in: ['ENVIADO', 'VENCIDO'] } }, data: { status: 'CANCELADO' } });
      if (r.count === 0) throw new HttpError(409, 'El presupuesto ya cambió de estado, recarga', 'STALE_STATE');
      await tx.quoteLinkToken.updateMany({ where: { versionId: cur.id, usedAt: null }, data: { usedAt: new Date() } });
    },
  });
  await audit('QUOTE_WITHDRAWN', 'Repair', repairId, userId, { version: cur.version, comment });
  return getQuote(repairId);
}

/** El enlace dura menos que el presupuesto: permite emitir uno nuevo (el anterior deja de valer) y reenviarlo. */
export async function resendLink(userId: number, repairId: number) {
  const repair = await loadRepair(repairId);
  await expireDueQuotes();
  const quote = await loadQuote(repairId);
  if (!quote) throw new HttpError(404, 'Aún no hay presupuesto');
  const cur = currentOf(quote);
  if (cur.status !== 'ENVIADO' || !cur.validUntil || repair.status !== 'PRESUPUESTO_PENDIENTE_APROBACION') {
    throw new HttpError(409, 'No hay un presupuesto pendiente de respuesta', 'NOTHING_PENDING');
  }
  if (!repair.customer.email) throw new HttpError(409, 'El cliente no tiene email', 'CUSTOMER_EMAIL_REQUIRED');
  const token = await issueLink(prisma, cur.id, cur.validUntil);
  await sendEmail({
    to: repair.customer.email, type: 'QUOTE_AVAILABLE', entity: 'Repair', entityId: String(repairId),
    ...quoteAvailableMail(repair.customer.name, {
      number: repair.number, tool: `${repair.tool.brand} ${repair.tool.model}`, total: money(cur.total), validUntil: cur.validUntil, approvalUrl: approvalUrl(token),
    }),
  });
  await audit('QUOTE_LINK_RESENT', 'Repair', repairId, userId, { version: cur.version });
  return getQuote(repairId);
}
