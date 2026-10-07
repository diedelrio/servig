import { Prisma, type SparePartStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http.js';

/** Flujo del doc: NECESARIO → SOLICITADO → PEDIDO_A_MARCA → RECIBIDO → INSTALADO. Se cancela desde cualquier estado no final. */
const NEXT: Record<SparePartStatus, SparePartStatus[]> = {
  NECESARIO: ['SOLICITADO', 'CANCELADO'],
  SOLICITADO: ['PEDIDO_A_MARCA', 'CANCELADO'],
  PEDIDO_A_MARCA: ['RECIBIDO', 'CANCELADO'],
  RECIBIDO: ['INSTALADO', 'CANCELADO'],
  INSTALADO: [],
  CANCELADO: [],
};
/** Repuestos que todavía no llegaron. */
export const PENDING: SparePartStatus[] = ['NECESARIO', 'SOLICITADO', 'PEDIDO_A_MARCA'];
const CLOSED_REPAIR = ['ENTREGADO', 'CANCELADO'];

type Row = Prisma.RepairSparePartGetPayload<object>;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const view = (p: Row) => ({
  id: p.id, repairId: p.repairId, code: p.code, description: p.description, supplier: p.supplier, quantity: p.quantity,
  cost: p.cost.toFixed(2), price: p.price.toFixed(2), status: p.status, orderedAt: day(p.orderedAt), receivedAt: day(p.receivedAt),
  notes: p.notes, nextStatuses: NEXT[p.status], createdAt: p.createdAt,
});

const nullify = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));
const toDate = (s?: string) => new Date((s ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');

async function openRepair(repairId: number) {
  const r = await prisma.repair.findUnique({ where: { id: repairId }, select: { id: true, status: true } });
  if (!r) throw new HttpError(404, 'Reparación no encontrada');
  if (CLOSED_REPAIR.includes(r.status)) throw new HttpError(409, 'La reparación ya está cerrada', 'REPAIR_CLOSED');
  return r;
}

async function loadPart(id: number) {
  const p = await prisma.repairSparePart.findUnique({ where: { id } });
  if (!p) throw new HttpError(404, 'Repuesto no encontrado');
  return p;
}

export async function list(repairId: number) {
  if (!(await prisma.repair.findUnique({ where: { id: repairId }, select: { id: true } }))) throw new HttpError(404, 'Reparación no encontrada');
  const parts = await prisma.repairSparePart.findMany({ where: { repairId }, orderBy: { id: 'asc' } });
  const live = parts.filter((p) => p.status !== 'CANCELADO');
  const sum = (f: (p: Row) => Prisma.Decimal) => live.reduce((a, p) => a.add(f(p)), new Prisma.Decimal(0)).toFixed(2);
  return {
    parts: parts.map(view),
    summary: {
      pending: parts.filter((p) => PENDING.includes(p.status)).length,
      notInstalled: live.filter((p) => p.status !== 'INSTALADO').length,
      totalCost: sum((p) => p.cost.mul(p.quantity)), // excluye cancelados
      totalPrice: sum((p) => p.price.mul(p.quantity)),
    },
  };
}

export async function create(userId: number, repairId: number, input: Record<string, unknown>) {
  await openRepair(repairId);
  const p = await prisma.repairSparePart.create({ data: { ...(nullify(input) as Prisma.RepairSparePartUncheckedCreateInput), repairId, createdById: userId } });
  await audit('SPARE_PART_ADDED', 'Repair', repairId, userId, { partId: p.id, description: p.description, quantity: p.quantity });
  return view(p);
}

export async function update(userId: number, id: number, input: Record<string, unknown>) {
  const p = await loadPart(id);
  await openRepair(p.repairId);
  if (p.status === 'INSTALADO' || p.status === 'CANCELADO') throw new HttpError(409, 'El repuesto ya está cerrado y no se puede modificar', 'PART_CLOSED');
  const u = await prisma.repairSparePart.update({ where: { id }, data: nullify(input) as Prisma.RepairSparePartUpdateInput });
  await audit('SPARE_PART_UPDATED', 'Repair', p.repairId, userId, { partId: id, fields: Object.keys(input) });
  return view(u);
}

export async function changeStatus(userId: number, id: number, to: SparePartStatus, date?: string) {
  const p = await loadPart(id);
  await openRepair(p.repairId);
  if (!NEXT[p.status].includes(to)) {
    throw new HttpError(409, `No se puede pasar de ${p.status} a ${to}`, 'INVALID_PART_TRANSITION');
  }
  const data: Prisma.RepairSparePartUpdateInput = { status: to };
  if (to === 'PEDIDO_A_MARCA') data.orderedAt = toDate(date);
  if (to === 'RECIBIDO') data.receivedAt = toDate(date);
  // Condicionado al estado leído: dos cambios simultáneos no se pisan.
  const r = await prisma.repairSparePart.updateMany({ where: { id, status: p.status }, data: data as Prisma.RepairSparePartUpdateManyMutationInput });
  if (r.count === 0) throw new HttpError(409, 'El repuesto cambió de estado, recarga', 'STALE_STATE');
  await audit('SPARE_PART_STATUS', 'Repair', p.repairId, userId, { partId: id, from: p.status, to });
  return view(await loadPart(id));
}

/** Usado por el workflow de la reparación. */
export const countPending = (repairId: number) => prisma.repairSparePart.count({ where: { repairId, status: { in: PENDING } } });
