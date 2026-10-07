import type { Prisma, RepairStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { overdueThresholds } from '../../lib/settings.js';

const FINAL: RepairStatus[] = ['ENTREGADO', 'CANCELADO'];
const DAY = 86_400_000;

type Scope = Prisma.RepairWhereInput;

/** Reparaciones no cerradas con desde cuándo están en su estado actual (fecha del último cambio de estado). */
async function openWithAge(scope: Scope, thresholds: Record<string, number>) {
  const rows = await prisma.repair.findMany({
    where: { ...scope, status: { notIn: FINAL } },
    select: {
      id: true, number: true, status: true, requiresQuote: true, receivedAt: true,
      customer: { select: { name: true } }, tool: { select: { type: true, brand: true, model: true } },
      history: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  });
  const now = Date.now();
  return rows.map((r) => {
    const since = r.history[0]?.createdAt ?? r.receivedAt;
    const threshold = thresholds[r.status];
    const elapsed = now - since.getTime();
    return { ...r, since, thresholdDays: threshold, daysInStatus: Math.floor(elapsed / DAY), overdue: elapsed > threshold * DAY };
  });
}

/** Ids de las reparaciones atrasadas (para el filtro de la lista). */
export async function overdueIds(scope: Scope = {}, thresholds?: Record<string, number>) {
  return (await openWithAge(scope, thresholds ?? (await overdueThresholds()))).filter((r) => r.overdue).map((r) => r.id);
}

/**
 * Contadores del taller. `scope` acota el universo (los tests lo usan para no depender de datos ajenos).
 * Cada contador se explica en docs/04: "pendientes de presupuesto" es un subconjunto de "en revisión".
 */
export async function dashboard(scope: Scope = {}, thresholds?: Record<string, number>) {
  const limits = thresholds ?? (await overdueThresholds());
  const grouped = await prisma.repair.groupBy({ by: ['status'], where: scope, _count: { _all: true } });
  const by = (s: RepairStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  const open = await openWithAge(scope, limits);
  const overdue = open.filter((r) => r.overdue).sort((a, b) => b.daysInStatus - b.thresholdDays - (a.daysInStatus - a.thresholdDays));

  return {
    counts: {
      received: by('RECIBIDO'),
      inReview: by('EN_REVISION'),
      pendingQuote: open.filter((r) => r.status === 'EN_REVISION' && r.requiresQuote).length,
      awaitingApproval: by('PRESUPUESTO_PENDIENTE_APROBACION'),
      approved: by('PRESUPUESTO_APROBADO'),
      awaitingParts: by('PEDIDO_REPUESTOS_MARCA'),
      inRepair: by('EN_REPARACION'),
      readyForPickup: by('LISTO_PARA_RETIRAR'),
      overdue: overdue.length,
      // Piden acción aunque no estén en la lista base: decidir qué hacer / avisar que está lista.
      rejected: by('PRESUPUESTO_RECHAZADO'),
      repaired: by('REPARADO'),
    },
    overdue: overdue.slice(0, 50).map((r) => ({
      id: r.id, number: r.number, status: r.status, customerName: r.customer.name, tool: `${r.tool.brand} ${r.tool.model}`,
      daysInStatus: r.daysInStatus, thresholdDays: r.thresholdDays, since: r.since,
    })),
    thresholds: limits,
  };
}
