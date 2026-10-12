import { prisma } from '../../lib/prisma.js';

const LIMIT = 8;
const MIN_CHARS = 2;

/**
 * Búsqueda global para el personal: clientes (nombre, DNI/NIF/CIF, email, teléfono), reparaciones (número, cliente,
 * herramienta) y herramientas (tipo, marca, modelo, serie). Devuelve solo lo necesario para enlazar; nunca observaciones.
 */
export async function globalSearch(raw: string) {
  const q = raw.trim();
  if (q.length < MIN_CHARS) return { q, customers: [], repairs: [], tools: [] };
  const has = { contains: q, mode: 'insensitive' as const };

  const [customers, repairs, tools] = await Promise.all([
    prisma.customer.findMany({
      where: { OR: [{ name: has }, { taxId: has }, { email: has }, { phone: has }] },
      orderBy: { name: 'asc' }, take: LIMIT,
      select: { id: true, name: true, taxId: true, email: true, phone: true },
    }),
    prisma.repair.findMany({
      where: { OR: [{ number: has }, { accountingReceipt: has }, { customer: { name: has } }, { tool: { OR: [{ type: has }, { brand: has }, { model: has }, { serialNumber: has }] } }] },
      orderBy: { receivedAt: 'desc' }, take: LIMIT,
      select: { id: true, number: true, status: true, customer: { select: { name: true } }, tool: { select: { type: true, brand: true, model: true } } },
    }),
    prisma.tool.findMany({
      where: { OR: [{ type: has }, { brand: has }, { model: has }, { serialNumber: has }] },
      orderBy: { createdAt: 'desc' }, take: LIMIT,
      select: { id: true, type: true, brand: true, model: true, serialNumber: true, customer: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    q,
    customers,
    repairs: repairs.map((r) => ({ id: r.id, number: r.number, status: r.status, customerName: r.customer.name, tool: `${r.tool.type} ${r.tool.brand} ${r.tool.model}` })),
    tools: tools.map((t) => ({ id: t.id, label: `${t.type} ${t.brand} ${t.model}`, serialNumber: t.serialNumber, customerId: t.customer.id, customerName: t.customer.name })),
  };
}
