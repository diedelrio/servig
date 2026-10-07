import type { HistoryOrigin, Prisma, RepairStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { sendEmail } from '../../lib/email.js';
import { HttpError } from '../../lib/http.js';
import { countPending } from '../spareparts/service.js';
import { repairFinishedMail, repairReadyMail } from '../../lib/emailTemplates.js';

type Actor = 'ADMIN' | 'RECEPCION' | 'TECNICO' | 'CUSTOMER' | 'SYSTEM';

export type Rule = {
  from: RepairStatus
  to: RepairStatus
  label: string // texto del botón
  actors: Actor[]
  /** Solo la dispara código interno (envío de presupuesto, decisión del cliente), nunca el endpoint público. */
  internal?: boolean
  needsComment?: boolean
  /** RN-02: solo reparaciones que no requieren presupuesto (garantía). */
  onlyIfNoQuote?: boolean
  /** Exige repuestos pendientes (para pedirlos) o ninguno pendiente (para seguir con la reparación). */
  parts?: 'needPending' | 'noPending'
}

const TEC: Actor[] = ['TECNICO', 'ADMIN']

// Fuente de verdad del workflow (docs/04-workflow-reparaciones.md).
// RN-01: EN_REPARACION solo es alcanzable desde PRESUPUESTO_APROBADO / PEDIDO_REPUESTOS_MARCA,
// o desde EN_REVISION cuando la reparación no requiere presupuesto. Los estados de presupuesto
// los fijan únicamente reglas `internal`, así que el personal no puede "saltarse" la aprobación.
const NON_FINAL: RepairStatus[] = [
  'RECIBIDO', 'EN_REVISION', 'PRESUPUESTO_PENDIENTE_APROBACION', 'PRESUPUESTO_APROBADO', 'PRESUPUESTO_RECHAZADO',
  'PEDIDO_REPUESTOS_MARCA', 'EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR',
]

export const RULES: Rule[] = [
  // Pedido hecho por el cliente desde el portal: la herramienta todavía no llegó al taller.
  { from: 'SOLICITADA', to: 'RECIBIDO', label: 'Registrar la recepción de la herramienta', actors: ['RECEPCION', 'ADMIN'] },
  { from: 'SOLICITADA', to: 'CANCELADO', label: 'Cancelar solicitud', actors: ['ADMIN', 'RECEPCION', 'CUSTOMER'] },
  { from: 'RECIBIDO', to: 'EN_REVISION', label: 'Iniciar revisión', actors: TEC },
  { from: 'EN_REVISION', to: 'PRESUPUESTO_PENDIENTE_APROBACION', label: 'Enviar presupuesto', actors: TEC, internal: true },
  { from: 'EN_REVISION', to: 'EN_REPARACION', label: 'Comenzar reparación (garantía sin presupuesto)', actors: TEC, onlyIfNoQuote: true },
  { from: 'PRESUPUESTO_PENDIENTE_APROBACION', to: 'PRESUPUESTO_APROBADO', label: 'Aprobar presupuesto', actors: ['CUSTOMER'], internal: true },
  { from: 'PRESUPUESTO_PENDIENTE_APROBACION', to: 'PRESUPUESTO_RECHAZADO', label: 'Rechazar presupuesto', actors: ['CUSTOMER'], internal: true },
  // Corregir un presupuesto ya enviado: la versión se cancela desde la acción "retirar" (quotes), no por el endpoint genérico.
  { from: 'PRESUPUESTO_PENDIENTE_APROBACION', to: 'EN_REVISION', label: 'Retirar presupuesto para corregirlo', actors: TEC, internal: true, needsComment: true },
  { from: 'PRESUPUESTO_APROBADO', to: 'PEDIDO_REPUESTOS_MARCA', label: 'Pedir repuestos a la marca', actors: TEC, parts: 'needPending' },
  { from: 'PRESUPUESTO_APROBADO', to: 'EN_REPARACION', label: 'Comenzar reparación', actors: TEC },
  { from: 'PEDIDO_REPUESTOS_MARCA', to: 'EN_REPARACION', label: 'Repuestos recibidos: comenzar reparación', actors: TEC, parts: 'noPending' },
  { from: 'PRESUPUESTO_RECHAZADO', to: 'EN_REVISION', label: 'Revisar y preparar nueva versión', actors: TEC },
  { from: 'PRESUPUESTO_RECHAZADO', to: 'LISTO_PARA_RETIRAR', label: 'Devolver sin reparar', actors: TEC, needsComment: true },
  { from: 'EN_REPARACION', to: 'REPARADO', label: 'Marcar como reparada', actors: TEC },
  { from: 'REPARADO', to: 'LISTO_PARA_RETIRAR', label: 'Lista para retirar', actors: ['TECNICO', 'RECEPCION', 'ADMIN'] },
  { from: 'LISTO_PARA_RETIRAR', to: 'ENTREGADO', label: 'Registrar entrega', actors: ['RECEPCION', 'ADMIN'] },
  ...NON_FINAL.map((from): Rule => ({ from, to: 'CANCELADO', label: 'Cancelar reparación', actors: ['ADMIN', 'RECEPCION'], needsComment: true })),
]

export const findRule = (from: RepairStatus, to: RepairStatus) => RULES.find((r) => r.from === from && r.to === to);

/** Acciones que un rol puede ejecutar a mano sobre una reparación (alimenta los botones del frontend). */
export function allowedFor(repair: { status: RepairStatus; requiresQuote: boolean }, role: string, ctx: { pendingParts?: number } = {}) {
  return RULES.filter(
    (r) =>
      r.from === repair.status && !r.internal && r.actors.includes(role as Actor) && !(r.onlyIfNoQuote && repair.requiresQuote) &&
      !partsBlocked(r, ctx.pendingParts),
  ).map((r) => ({ to: r.to, label: r.label, needsComment: !!r.needsComment }));
}

/** pendingParts indefinido = no se evalúa (tests de la matriz pura). */
const partsBlocked = (r: Rule, pending?: number) =>
  pending !== undefined && ((r.parts === 'needPending' && pending === 0) || (r.parts === 'noPending' && pending > 0));

export type TransitionInput = {
  repairId: number
  to: RepairStatus
  /** STAFF usa el rol real del usuario; los orígenes de cliente/sistema se mapean a CUSTOMER/SYSTEM. */
  actor: { userId: number | null; role: string | null; origin: HistoryOrigin }
  comment?: string
  /** Solo true cuando lo invoca código interno confiable. */
  internal?: boolean
  /** Se ejecuta dentro de la misma transacción que el cambio de estado: si falla, nada se guarda. */
  inTx?: (tx: Prisma.TransactionClient) => Promise<void>
}

const actorOf = (a: TransitionInput['actor']): Actor | null =>
  a.origin === 'STAFF' ? (a.role as Actor | null) : a.origin === 'SYSTEM' ? 'SYSTEM' : 'CUSTOMER';

/** ÚNICO punto por el que cambia el estado de una reparación. */
export async function transitionRepair(i: TransitionInput) {
  const repair = await prisma.repair.findUnique({ where: { id: i.repairId }, include: { customer: true, tool: true } });
  if (!repair) throw new HttpError(404, 'Reparación no encontrada');

  const rule = findRule(repair.status, i.to);
  if (!rule || (rule.internal && !i.internal)) {
    throw new HttpError(409, 'Transición no permitida desde el estado actual', 'INVALID_TRANSITION');
  }
  const actor = actorOf(i.actor);
  if (!actor || !rule.actors.includes(actor)) throw new HttpError(403, 'Tu rol no puede realizar esta acción');
  if (rule.onlyIfNoQuote && repair.requiresQuote) {
    throw new HttpError(409, 'Esta reparación requiere presupuesto aprobado antes de comenzar', 'QUOTE_REQUIRED');
  }
  // RN-01: además del estado, debe existir la aprobación registrada de la ÚLTIMA versión del presupuesto.
  if (i.to === 'EN_REPARACION' && repair.requiresQuote) await assertQuoteApproved(repair.id);
  if (rule.parts) {
    const pending = await countPending(repair.id);
    if (rule.parts === 'needPending' && pending === 0) throw new HttpError(409, 'No hay repuestos pendientes que pedir: regístralos primero', 'NO_PENDING_PARTS');
    if (rule.parts === 'noPending' && pending > 0) throw new HttpError(409, 'Aún hay repuestos sin recibir', 'PARTS_PENDING');
  }
  const comment = i.comment?.trim() || null;
  if (rule.needsComment && !comment) throw new HttpError(400, 'Esta acción requiere un comentario', 'COMMENT_REQUIRED');

  await prisma.$transaction(async (tx) => {
    // Cambio condicionado al estado leído: si otra petición se adelantó, esta falla en vez de pisarla.
    const r = await tx.repair.updateMany({ where: { id: repair.id, status: repair.status }, data: { status: i.to } });
    if (r.count === 0) throw new HttpError(409, 'La reparación cambió de estado, recarga e inténtalo de nuevo', 'STALE_STATE');
    await tx.repairStatusHistory.create({
      data: { repairId: repair.id, fromStatus: repair.status, toStatus: i.to, userId: i.actor.userId, comment, origin: i.actor.origin },
    });
    await i.inTx?.(tx);
  });
  await audit('REPAIR_STATUS_CHANGED', 'Repair', repair.id, i.actor.userId, { from: repair.status, to: i.to, origin: i.actor.origin });

  await notifyCustomer(repair, i.to);
  return prisma.repair.findUniqueOrThrow({ where: { id: repair.id } });
}

async function notifyCustomer(
  repair: { id: number; number: string; customer: { name: string; email: string | null }; tool: { brand: string; model: string } },
  to: RepairStatus,
) {
  const mail = to === 'REPARADO' ? repairFinishedMail : to === 'LISTO_PARA_RETIRAR' ? repairReadyMail : null;
  if (!mail || !repair.customer.email) return;
  await sendEmail({
    to: repair.customer.email,
    type: to === 'REPARADO' ? 'REPAIR_FINISHED' : 'REPAIR_READY',
    entity: 'Repair',
    entityId: String(repair.id),
    ...mail(repair.customer.name, { number: repair.number, tool: `${repair.tool.brand} ${repair.tool.model}` }),
  });
}

async function assertQuoteApproved(repairId: number) {
  const quote = await prisma.quote.findUnique({ where: { repairId }, include: { versions: { include: { approval: true } } } });
  const cur = quote?.versions.find((v) => v.version === quote.currentVersion);
  if (!cur || cur.status !== 'APROBADO' || cur.approval?.decision !== 'APROBADO') {
    throw new HttpError(409, 'No hay una aprobación del cliente para la última versión del presupuesto', 'QUOTE_REQUIRED');
  }
}
