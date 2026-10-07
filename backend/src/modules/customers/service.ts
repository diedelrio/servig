import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http.js';
import { linkCustomerByEmail } from '../../lib/customerLink.js';

/** '' → null; así vaciar un campo en la edición lo borra. */
const nullify = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as { [K in keyof T]: Exclude<T[K], ''> | null };

const toDate = (v: unknown) => (typeof v === 'string' && v ? new Date(v + 'T00:00:00Z') : v === null ? null : undefined);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function conflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const target = String((e.meta?.target as string[] | undefined)?.join(',') ?? '');
    if (target.includes('taxId')) throw new HttpError(409, 'Ya existe un cliente con ese DNI/NIF/CIF', 'DUPLICATE_TAXID');
    if (target.includes('email')) throw new HttpError(409, 'Ya existe un cliente con ese email', 'DUPLICATE_EMAIL');
  }
  throw e;
}

// ---------- Clientes ----------

export async function listCustomers(search?: string) {
  const where: Prisma.CustomerWhereInput = search
    ? { OR: ['name', 'taxId', 'email', 'phone'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' } })) }
    : {};
  const rows = await prisma.customer.findMany({ where, include: { _count: { select: { tools: true } } }, orderBy: { name: 'asc' }, take: 200 });
  return rows.map(({ _count, ...c }) => ({ ...c, toolCount: _count.tools }));
}

export async function getCustomer(id: number) {
  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      tools: { orderBy: { createdAt: 'desc' } },
      users: { select: { id: true, email: true, status: true } },
      repairs: { orderBy: { receivedAt: 'desc' }, select: { id: true, number: true, status: true, receivedAt: true, toolId: true, declaredFault: true } },
    },
  });
  if (!c) throw new HttpError(404, 'Cliente no encontrado');
  const { users, tools, ...rest } = c;
  return { ...rest, portalUser: users[0] ?? null, tools: tools.map(toolView) };
}

export async function createCustomer(userId: number, input: Record<string, unknown>) {
  try {
    const c = await prisma.customer.create({ data: nullify(input) as Prisma.CustomerCreateInput });
    await audit('CUSTOMER_CREATED', 'Customer', c.id, userId);
    await linkCustomerByEmail(c.email);
    return c;
  } catch (e) {
    conflict(e);
  }
}

export async function updateCustomer(userId: number, id: number, input: Record<string, unknown>) {
  try {
    const c = await prisma.customer.update({ where: { id }, data: nullify(input) as Prisma.CustomerUpdateInput });
    await audit('CUSTOMER_UPDATED', 'Customer', id, userId, { fields: Object.keys(input) });
    await linkCustomerByEmail(c.email);
    return c;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new HttpError(404, 'Cliente no encontrado');
    conflict(e);
  }
}

// ---------- Herramientas ----------

type ToolRow = Prisma.ToolGetPayload<object>;
export const toolView = (t: ToolRow) => ({
  ...t,
  purchaseDate: day(t.purchaseDate),
  warrantyExpiresAt: day(t.warrantyExpiresAt),
  // Informativo: la garantía se confirma en cada recepción (campo inWarranty de la reparación).
  warrantyActive: !!t.warrantyExpiresAt && t.warrantyExpiresAt >= new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'),
});

const toolData = (input: Record<string, unknown>) => {
  const { purchaseDate, warrantyExpiresAt, ...rest } = input;
  return { ...nullify(rest), purchaseDate: toDate(purchaseDate), warrantyExpiresAt: toDate(warrantyExpiresAt) };
};

export async function listTools(q: { customerId?: number; search?: string }) {
  const where: Prisma.ToolWhereInput = {};
  if (q.customerId) where.customerId = q.customerId;
  if (q.search) where.OR = ['type', 'brand', 'model', 'serialNumber'].map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' } }));
  const rows = await prisma.tool.findMany({ where, include: { customer: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  return rows.map((t) => ({ ...toolView(t), customer: t.customer }));
}

export async function getTool(id: number) {
  const t = await prisma.tool.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true } } } });
  if (!t) throw new HttpError(404, 'Herramienta no encontrada');
  return { ...toolView(t), customer: t.customer };
}

export async function createTool(userId: number, input: Record<string, unknown> & { customerId: number }) {
  if (!(await prisma.customer.findUnique({ where: { id: input.customerId } }))) throw new HttpError(404, 'Cliente no encontrado');
  const t = await prisma.tool.create({ data: toolData(input) as Prisma.ToolUncheckedCreateInput });
  await audit('TOOL_CREATED', 'Tool', t.id, userId, { customerId: t.customerId });
  return toolView(t);
}

export async function updateTool(userId: number, id: number, input: Record<string, unknown>) {
  try {
    const t = await prisma.tool.update({ where: { id }, data: toolData(input) as Prisma.ToolUpdateInput });
    await audit('TOOL_UPDATED', 'Tool', id, userId, { fields: Object.keys(input) });
    return toolView(t);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new HttpError(404, 'Herramienta no encontrada');
    throw e;
  }
}
