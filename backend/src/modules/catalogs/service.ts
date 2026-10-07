import { Prisma } from '@prisma/client';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';

/** Clave de unicidad: sin espacios repetidos y sin distinguir mayúsculas («Bosch» = «bosch» = «BOSCH »). */
export const keyOf = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (name: string) => name.trim().replace(/\s+/g, ' ');

type Kind = 'brand' | 'type';
/** Marcas y tipos tienen la misma forma; un tipo común evita duplicar las operaciones. */
type Named = { id: number; name: string; nameKey: string };
type NamedDelegate = {
  create(a: { data: { name: string; nameKey: string } }): Promise<Named>;
  update(a: { where: { id: number }; data: { name: string; nameKey: string } }): Promise<Named>;
  delete(a: { where: { id: number } }): Promise<unknown>;
  findUnique(a: { where: { id: number }; include?: { _count: { select: { models: true } } } }): Promise<(Named & { _count: { models: number } }) | null>;
};
const delegate = (k: Kind, db: Prisma.TransactionClient = prisma) => (k === 'brand' ? db.brand : db.toolType) as unknown as NamedDelegate;
const LABEL: Record<Kind, string> = { brand: 'La marca', type: 'El tipo de herramienta' };

/** Todo el catálogo de una vez: es chico y la pantalla y el alta de herramientas lo usan completo. */
export async function listCatalogs() {
  const [brands, types, models] = await Promise.all([
    prisma.brand.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { models: true } } } }),
    prisma.toolType.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { models: true } } } }),
    prisma.toolModel.findMany({ orderBy: { name: 'asc' }, include: { brand: true, toolType: true, _count: { select: { tools: true } } } }),
  ]);
  return {
    brands: brands.map((b) => ({ id: b.id, name: b.name, models: b._count.models })),
    types: types.map((t) => ({ id: t.id, name: t.name, models: t._count.models })),
    models: models.map((m) => ({ id: m.id, name: m.name, brandId: m.brandId, brand: m.brand.name, toolTypeId: m.toolTypeId, type: m.toolType.name, tools: m._count.tools })),
  };
}

const duplicate = (e: unknown, msg: string) => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new HttpError(409, msg, 'DUPLICATE');
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new HttpError(404, 'No encontrado');
  throw e;
};

/** Repite en las herramientas el nombre del catálogo (correos, resguardos y búsquedas leen esa copia). */
const syncTools = (tx: Prisma.TransactionClient, where: Prisma.ToolWhereInput, data: { brand?: string; type?: string; model?: string }) =>
  tx.tool.updateMany({ where, data });

export async function createNamed(userId: number, kind: Kind, name: string) {
  const n = clean(name);
  try {
    const row = await delegate(kind).create({ data: { name: n, nameKey: keyOf(n) } });
    await audit('CATALOG_CREATED', kind === 'brand' ? 'Brand' : 'ToolType', row.id, userId, { name: n });
    return row;
  } catch (e) {
    return duplicate(e, `${LABEL[kind]} «${n}» ya existe`);
  }
}

export async function renameNamed(userId: number, kind: Kind, id: number, name: string) {
  const n = clean(name);
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await delegate(kind, tx).findUnique({ where: { id } });
      if (!before) throw new HttpError(404, 'No encontrado');
      const row = await delegate(kind, tx).update({ where: { id }, data: { name: n, nameKey: keyOf(n) } });
      await syncTools(tx, { catalogModel: kind === 'brand' ? { brandId: id } : { toolTypeId: id } }, kind === 'brand' ? { brand: n } : { type: n });
      await tx.auditLog.create({ data: { action: 'CATALOG_UPDATED', entity: kind === 'brand' ? 'Brand' : 'ToolType', entityId: String(id), userId, data: { from: before.name, to: n } } });
      return row;
    });
  } catch (e) {
    return duplicate(e, `${LABEL[kind]} «${n}» ya existe`);
  }
}

export async function removeNamed(userId: number, kind: Kind, id: number) {
  const row = await delegate(kind).findUnique({ where: { id }, include: { _count: { select: { models: true } } } });
  if (!row) throw new HttpError(404, 'No encontrado');
  if (row._count.models) throw new HttpError(409, `${LABEL[kind]} «${row.name}» tiene ${row._count.models} modelo(s): elimínalos o muévelos primero`, 'IN_USE');
  await delegate(kind).delete({ where: { id } });
  await audit('CATALOG_DELETED', kind === 'brand' ? 'Brand' : 'ToolType', id, userId, { name: row.name });
}

type ModelInput = { name: string; brandId: number; toolTypeId: number };

async function refs(brandId: number, toolTypeId: number) {
  const [brand, type] = await Promise.all([prisma.brand.findUnique({ where: { id: brandId } }), prisma.toolType.findUnique({ where: { id: toolTypeId } })]);
  if (!brand) throw new HttpError(400, 'La marca no existe', 'INVALID_REFERENCE');
  if (!type) throw new HttpError(400, 'El tipo de herramienta no existe', 'INVALID_REFERENCE');
  return { brand, type };
}

export async function createModel(userId: number, input: ModelInput) {
  const n = clean(input.name);
  await refs(input.brandId, input.toolTypeId);
  try {
    const row = await prisma.toolModel.create({ data: { name: n, nameKey: keyOf(n), brandId: input.brandId, toolTypeId: input.toolTypeId } });
    await audit('CATALOG_CREATED', 'ToolModel', row.id, userId, { name: n, brandId: input.brandId, toolTypeId: input.toolTypeId });
    return row;
  } catch (e) {
    return duplicate(e, `El modelo «${n}» ya existe para esa marca y tipo`);
  }
}

/** Renombrar o mover un modelo (otra marca/tipo) actualiza las herramientas que lo usan. */
export async function updateModel(userId: number, id: number, input: ModelInput) {
  const n = clean(input.name);
  const { brand, type } = await refs(input.brandId, input.toolTypeId);
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.toolModel.findUnique({ where: { id } });
      if (!before) throw new HttpError(404, 'No encontrado');
      const row = await tx.toolModel.update({ where: { id }, data: { name: n, nameKey: keyOf(n), brandId: input.brandId, toolTypeId: input.toolTypeId } });
      await syncTools(tx, { modelId: id }, { model: n, brand: brand.name, type: type.name });
      await tx.auditLog.create({ data: { action: 'CATALOG_UPDATED', entity: 'ToolModel', entityId: String(id), userId, data: { from: { name: before.name, brandId: before.brandId, toolTypeId: before.toolTypeId }, to: { name: n, brandId: input.brandId, toolTypeId: input.toolTypeId } } } });
      return row;
    });
  } catch (e) {
    return duplicate(e, `El modelo «${n}» ya existe para esa marca y tipo`);
  }
}

export async function removeModel(userId: number, id: number) {
  const row = await prisma.toolModel.findUnique({ where: { id }, include: { _count: { select: { tools: true } } } });
  if (!row) throw new HttpError(404, 'No encontrado');
  if (row._count.tools) throw new HttpError(409, `El modelo «${row.name}» lo usan ${row._count.tools} herramienta(s)`, 'IN_USE');
  await prisma.toolModel.delete({ where: { id } });
  await audit('CATALOG_DELETED', 'ToolModel', id, userId, { name: row.name });
}

/** Para el alta de herramientas: devuelve los textos que se copian a la herramienta. */
export async function resolveModel(modelId: number) {
  const m = await prisma.toolModel.findUnique({ where: { id: modelId }, include: { brand: true, toolType: true } });
  if (!m) throw new HttpError(400, 'El modelo del catálogo no existe', 'INVALID_REFERENCE');
  return { modelId: m.id, type: m.toolType.name, brand: m.brand.name, model: m.name };
}
