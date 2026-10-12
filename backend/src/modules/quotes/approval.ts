import type { HistoryOrigin, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { env } from '../../lib/env.js';
import { getBusiness, getNumber } from '../../lib/settings.js';
import { sendEmail } from '../../lib/email.js';
import { HttpError } from '../../lib/http.js';
import { hashToken, newToken } from '../../lib/security.js';
import { quoteDecisionMail, staffQuoteDecisionMail } from '../../lib/emailTemplates.js';
import { transitionRepair } from '../repairs/workflow.js';
import { expireDueQuotes } from './service.js';

type Db = Prisma.TransactionClient | typeof prisma;

export const approvalUrl = (token: string) => `${env.frontendUrl}/quote-approval?token=${encodeURIComponent(token)}`;

/** Emite un enlace nuevo para la versión e invalida los anteriores. Vence a los N días, sin pasar de la validez del presupuesto. */
export async function issueLink(db: Db, versionId: number, validUntil: Date) {
  const token = newToken();
  await db.quoteLinkToken.updateMany({ where: { versionId, usedAt: null }, data: { usedAt: new Date() } });
  const byDays = new Date(Date.now() + (await getNumber('quote.approvalLinkDays')) * 86_400_000);
  await db.quoteLinkToken.create({
    data: { versionId, tokenHash: hashToken(token), expiresAt: byDays < validUntil ? byDays : validUntil },
  });
  return token;
}

export type LinkState = 'OPEN' | 'DECIDED' | 'WITHDRAWN' | 'EXPIRED' | 'REPLACED' | 'LINK_EXPIRED';

const STATE_ERROR: Record<Exclude<LinkState, 'OPEN'>, [string, string]> = {
  DECIDED: ['Este presupuesto ya fue respondido', 'ALREADY_DECIDED'],
  WITHDRAWN: ['Este presupuesto fue retirado por el taller; recibirá uno nuevo', 'QUOTE_WITHDRAWN'],
  EXPIRED: ['Este presupuesto venció; solicite uno nuevo al taller', 'QUOTE_EXPIRED'],
  REPLACED: ['Este enlace fue reemplazado por uno más reciente; revise su correo', 'LINK_REPLACED'],
  LINK_EXPIRED: ['El enlace venció; solicite uno nuevo al taller', 'LINK_EXPIRED'],
};

async function loadLink(token: string) {
  await expireDueQuotes();
  const link = await prisma.quoteLinkToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      version: {
        include: {
          items: { orderBy: { position: 'asc' } },
          approval: true,
          sentBy: { select: { id: true, email: true, firstName: true, status: true } },
          quote: { include: { repair: { include: { customer: true, tool: true, diagnoses: { where: { visibleToCustomer: true }, orderBy: { createdAt: 'asc' } } } } } },
        },
      },
    },
  });
  if (!link) throw new HttpError(404, 'Enlace no válido');
  return link;
}
type Link = Awaited<ReturnType<typeof loadLink>>;

function stateOf(l: Link): LinkState {
  const v = l.version;
  if (v.approval) return 'DECIDED';
  if (v.status === 'CANCELADO' || v.version !== v.quote.currentVersion) return 'WITHDRAWN';
  if (v.status === 'VENCIDO' || (v.validUntil && v.validUntil < new Date())) return 'EXPIRED';
  if (v.status !== 'ENVIADO') return 'WITHDRAWN';
  if (l.usedAt) return 'REPLACED'; // un token usado sin decisión es un enlace reemplazado
  if (l.expiresAt < new Date()) return 'LINK_EXPIRED';
  return 'OPEN';
}

/** Lo que ve el cliente al abrir su enlace. No expone email, teléfono ni dirección. */
export async function viewByLink(token: string) {
  const l = await loadLink(token);
  const state = stateOf(l);
  const business = await getBusiness();
  const v = l.version;
  const repair = v.quote.repair;
  const base = {
    state,
    business: { name: business.name, phone: business.phone },
    repair: { id: repair.id, number: repair.number },
    customerName: repair.customer.name,
    tool: `${repair.tool.brand} ${repair.tool.model}`,
  };
  if (state !== 'OPEN' && state !== 'DECIDED') return base;
  return {
    ...base,
    quote: {
      version: v.version, notes: v.notes, validUntil: v.validUntil,
      subtotal: v.subtotal.toFixed(2), taxTotal: v.taxTotal.toFixed(2), total: v.total.toFixed(2),
      items: v.items.map((i) => ({
        type: i.type, description: i.description, quantity: i.quantity.toFixed(2), unitPrice: i.unitPrice.toFixed(2),
        taxRate: i.taxRate.toFixed(2), lineNet: i.lineNet.toFixed(2),
      })),
    },
    diagnoses: repair.diagnoses.map((d) => ({ text: d.text, createdAt: d.createdAt })),
    decision: v.approval ? { decision: v.approval.decision, decidedAt: v.approval.decidedAt } : null,
  };
}

export type DecideInput = {
  versionId: number
  decision: 'APPROVE' | 'REJECT'
  origin: Extract<HistoryOrigin, 'CUSTOMER_LINK' | 'CUSTOMER_PORTAL'>
  userId?: number | null
  linkTokenId?: number
  comment?: string
  ip?: string
  userAgent?: string
}

/**
 * Registra la decisión del cliente. Todo o nada, en una transacción: consumo del enlace, cierre de la versión,
 * registro de la aprobación (con IP y origen) y cambio de estado de la reparación. Lo usan el enlace y el portal.
 */
export async function decideQuote(i: DecideInput) {
  await expireDueQuotes();
  const v = await prisma.quoteVersion.findUnique({
    where: { id: i.versionId },
    include: { quote: { include: { repair: { include: { customer: true, tool: true } } } }, sentBy: true },
  });
  if (!v) throw new HttpError(404, 'Presupuesto no encontrado');
  if (v.version !== v.quote.currentVersion) throw new HttpError(409, ...STATE_ERROR.WITHDRAWN);
  if (v.status === 'APROBADO' || v.status === 'RECHAZADO') throw new HttpError(409, ...STATE_ERROR.DECIDED);
  if (v.status === 'CANCELADO') throw new HttpError(409, ...STATE_ERROR.WITHDRAWN);
  if (v.status === 'VENCIDO' || (v.validUntil && v.validUntil < new Date())) throw new HttpError(409, ...STATE_ERROR.EXPIRED);
  if (v.status !== 'ENVIADO') throw new HttpError(404, 'Presupuesto no encontrado');

  const approved = i.decision === 'APPROVE';
  const decision = approved ? 'APROBADO' : 'RECHAZADO';
  const comment = i.comment?.trim() || null;
  const via = i.origin === 'CUSTOMER_LINK' ? 'enlace' : 'portal';

  await transitionRepair({
    repairId: v.quote.repairId,
    to: approved ? 'PRESUPUESTO_APROBADO' : 'PRESUPUESTO_RECHAZADO',
    internal: true,
    actor: { userId: i.userId ?? null, role: null, origin: i.origin },
    comment: `Presupuesto v${v.version} ${approved ? 'aprobado' : 'rechazado'} por el cliente (${via})${comment ? `: ${comment}` : ''}`,
    inTx: async (tx) => {
      if (i.linkTokenId) {
        const t = await tx.quoteLinkToken.updateMany({ where: { id: i.linkTokenId, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (t.count === 0) throw new HttpError(409, ...STATE_ERROR.REPLACED);
      }
      const r = await tx.quoteVersion.updateMany({ where: { id: v.id, status: 'ENVIADO' }, data: { status: decision } });
      if (r.count === 0) throw new HttpError(409, ...STATE_ERROR.DECIDED);
      await tx.quoteApproval.create({
        data: {
          versionId: v.id, decision, origin: i.origin, userId: i.userId ?? null, comment,
          ip: i.ip?.slice(0, 64), userAgent: i.userAgent?.slice(0, 300),
        },
      });
    },
  });

  const repair = v.quote.repair;
  const total = v.total.toFixed(2);
  await audit(approved ? 'QUOTE_APPROVED' : 'QUOTE_REJECTED', 'Repair', repair.id, i.userId ?? null, { version: v.version, origin: i.origin, total }, i.ip);

  if (repair.customer.email) {
    await sendEmail({
      to: repair.customer.email, type: approved ? 'QUOTE_APPROVED' : 'QUOTE_REJECTED', entity: 'Repair', entityId: String(repair.id),
      ...quoteDecisionMail(repair.customer.name, { number: repair.number, tool: `${repair.tool.brand} ${repair.tool.model}`, total, decision }),
    });
  }
  if (v.sentBy && v.sentBy.status === 'ACTIVE') {
    await sendEmail({
      to: v.sentBy.email, type: 'STAFF_QUOTE_DECISION', entity: 'Repair', entityId: String(repair.id),
      ...staffQuoteDecisionMail(v.sentBy.firstName, { number: repair.number, customer: repair.customer.name, total, decision, comment }),
    });
  }
  return { decision, repairNumber: repair.number };
}

/**
 * El enlace del correo ya no decide: aprobar o rechazar exige haber iniciado sesión con la cuenta del cliente (RN-19, ver RN-35).
 * Se mantiene la ruta para que un enlace viejo explique qué hacer en vez de fallar sin más.
 */
export async function decideByLink(token: string) {
  const l = await loadLink(token);
  const state = stateOf(l);
  if (state !== 'OPEN') throw new HttpError(409, ...STATE_ERROR[state]);
  throw new HttpError(403, 'Para aprobar o rechazar el presupuesto inicie sesión con su usuario', 'LOGIN_REQUIRED');
}
