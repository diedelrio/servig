import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

vi.mock('../src/lib/email.js', async (orig) => ({ ...(await orig<typeof import('../src/lib/email.js')>()), sendEmail: vi.fn(async () => true) }));

const { cleanup } = await import('./cleanup.js');
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/security.js');
const { keyOf } = await import('../src/modules/catalogs/service.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@cat.local';
const TAG = `Zq${Date.now().toString(36)}`;
const uniq = (p = 'c') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

async function api(path: string, opts: { method?: string; body?: object; auth?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function userWith(role: string) {
  const email = uniq(role.toLowerCase());
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.user.create({ data: { email, firstName: 'Cat', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() } });
  return (await api('/api/auth/login', { method: 'POST', body: { email, password: PW } })).json.accessToken as string;
}
let adm: string, rec: string;
let customerId: number;

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  [adm, rec] = await Promise.all([userWith('ADMIN'), userWith('RECEPCION')]);
  customerId = (await api('/api/customers', { method: 'POST', auth: rec, body: { name: 'Cliente Catálogo', email: uniq('cli') } })).json.id;
});
afterAll(async () => {
  await cleanup(prisma, DOMAIN);
  await prisma.toolModel.deleteMany({ where: { nameKey: { startsWith: TAG.toLowerCase() } } });
  await prisma.toolModel.deleteMany({ where: { brand: { nameKey: { startsWith: TAG.toLowerCase() } } } });
  await prisma.brand.deleteMany({ where: { nameKey: { startsWith: TAG.toLowerCase() } } });
  await prisma.toolType.deleteMany({ where: { nameKey: { startsWith: TAG.toLowerCase() } } });
  server.close();
  await prisma.$disconnect();
});

let brandId: number, typeId: number, modelId: number;

describe('catálogos de marcas, tipos y modelos', () => {
  it('keyOf ignora mayúsculas y espacios repetidos', () => {
    expect(keyOf('  Bosch  GSR ')).toBe('bosch gsr');
  });

  it('solo ADMIN escribe; quien da de alta herramientas puede leer', async () => {
    expect((await api('/api/catalogs')).status).toBe(401);
    expect((await api('/api/catalogs', { auth: rec })).status).toBe(200);
    expect((await api('/api/catalogs/brands', { method: 'POST', auth: rec, body: { name: `${TAG} x` } })).status).toBe(403);
    expect((await api('/api/catalogs/types', { method: 'POST', auth: rec, body: { name: `${TAG} x` } })).status).toBe(403);
  });

  it('crea marca, tipo y modelo; impide duplicados aunque cambien mayúsculas o espacios', async () => {
    const b = await api('/api/catalogs/brands', { method: 'POST', auth: adm, body: { name: `  ${TAG}  Marca ` } });
    expect(b.status).toBe(201);
    expect(b.json.name).toBe(`${TAG} Marca`);
    brandId = b.json.id;
    expect((await api('/api/catalogs/brands', { method: 'POST', auth: adm, body: { name: `${TAG.toLowerCase()} MARCA` } })).status).toBe(409);
    const t = await api('/api/catalogs/types', { method: 'POST', auth: adm, body: { name: `${TAG} Taladro` } });
    typeId = t.json.id;
    const m = await api('/api/catalogs/models', { method: 'POST', auth: adm, body: { name: 'GSB-1', brandId, toolTypeId: typeId } });
    expect(m.status).toBe(201);
    modelId = m.json.id;
    expect((await api('/api/catalogs/models', { method: 'POST', auth: adm, body: { name: 'gsb-1', brandId, toolTypeId: typeId } })).status).toBe(409);
    expect((await api('/api/catalogs/models', { method: 'POST', auth: adm, body: { name: 'X', brandId: 99999999, toolTypeId: typeId } })).status).toBe(400);
    expect((await api('/api/catalogs/brands', { method: 'POST', auth: adm, body: { name: '   ' } })).status).toBe(400);

    const all = (await api('/api/catalogs', { auth: adm })).json;
    expect(all.models.find((x: { id: number }) => x.id === modelId)).toMatchObject({ name: 'GSB-1', brand: `${TAG} Marca`, type: `${TAG} Taladro`, tools: 0 });
    expect(all.brands.find((x: { id: number }) => x.id === brandId).models).toBe(1);
  });

  it('una herramienta elegida del catálogo copia marca, tipo y modelo', async () => {
    const t = await api('/api/tools', { method: 'POST', auth: rec, body: { customerId, modelId } });
    expect(t.status).toBe(201);
    expect(t.json).toMatchObject({ type: `${TAG} Taladro`, brand: `${TAG} Marca`, model: 'GSB-1', modelId });
    // sin catálogo hay que escribir los tres
    const bad = await api('/api/tools', { method: 'POST', auth: rec, body: { customerId, type: 'x' } });
    expect(bad.status).toBe(400);
    expect(bad.json.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['brand', 'model']));
    // modelo inexistente
    expect((await api('/api/tools', { method: 'POST', auth: rec, body: { customerId, modelId: 99999999 } })).status).toBe(400);
    // texto libre sigue funcionando y no queda enlazado
    const free = await api('/api/tools', { method: 'POST', auth: rec, body: { customerId, type: 'T', brand: 'B', model: 'M' } });
    expect(free.json.modelId).toBeNull();
  });

  it('renombrar propaga el nombre a las herramientas que lo usan', async () => {
    expect((await api(`/api/catalogs/brands/${brandId}`, { method: 'PUT', auth: adm, body: { name: `${TAG} Marca Nueva` } })).status).toBe(200);
    expect((await api(`/api/catalogs/models/${modelId}`, { method: 'PUT', auth: adm, body: { name: 'GSB-2', brandId, toolTypeId: typeId } })).status).toBe(200);
    const tools = (await api(`/api/tools?customerId=${customerId}`, { auth: rec })).json as { modelId: number | null; brand: string; model: string }[];
    expect(tools.find((x) => x.modelId === modelId)).toMatchObject({ brand: `${TAG} Marca Nueva`, model: 'GSB-2' });
    expect(await prisma.auditLog.count({ where: { action: 'CATALOG_UPDATED', entityId: String(modelId), entity: 'ToolModel' } })).toBe(1);
  });

  it('mover un modelo a otro tipo actualiza las herramientas', async () => {
    const t2 = (await api('/api/catalogs/types', { method: 'POST', auth: adm, body: { name: `${TAG} Amoladora` } })).json.id;
    await api(`/api/catalogs/models/${modelId}`, { method: 'PUT', auth: adm, body: { name: 'GSB-2', brandId, toolTypeId: t2 } });
    const tools = (await api(`/api/tools?customerId=${customerId}`, { auth: rec })).json as { modelId: number | null; type: string }[];
    expect(tools.find((x) => x.modelId === modelId)!.type).toBe(`${TAG} Amoladora`);
  });

  it('no se puede borrar lo que está en uso; lo libre sí, con auditoría', async () => {
    expect((await api(`/api/catalogs/models/${modelId}`, { method: 'DELETE', auth: adm })).status).toBe(409); // lo usa una herramienta
    expect((await api(`/api/catalogs/brands/${brandId}`, { method: 'DELETE', auth: adm })).status).toBe(409); // tiene modelos
    const free = (await api('/api/catalogs/models', { method: 'POST', auth: adm, body: { name: 'LIBRE', brandId, toolTypeId: typeId } })).json.id;
    expect((await api(`/api/catalogs/models/${free}`, { method: 'DELETE', auth: adm })).status).toBe(204);
    expect(await prisma.auditLog.count({ where: { action: 'CATALOG_DELETED', entityId: String(free) } })).toBe(1);
    expect((await api(`/api/catalogs/models/${free}`, { method: 'DELETE', auth: adm })).status).toBe(404);
  });

  it('editar la herramienta con texto libre la desvincula del catálogo', async () => {
    const tool = (await prisma.tool.findFirstOrThrow({ where: { modelId } }));
    const r = await api(`/api/tools/${tool.id}`, { method: 'PATCH', auth: rec, body: { brand: 'Otra' } });
    expect(r.json.modelId).toBeNull();
  });
});
