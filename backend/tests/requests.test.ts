import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const sent: { to: string; type: string; subject: string }[] = [];
vi.mock('../src/lib/email.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/email.js')>()),
  sendEmail: vi.fn(async (m) => {
    sent.push(m);
    return true;
  }),
}));

const { cleanup } = await import('./cleanup.js');
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/security.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@req.local';
const uniq = (p = 'r') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

async function api(path: string, opts: { method?: string; body?: object; auth?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function userWith(role: string, email = uniq(role.toLowerCase())) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const u = await prisma.user.create({ data: { email, firstName: 'Req', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json.accessToken as string };
}
type Who = Awaited<ReturnType<typeof userWith>>;
let rec: Who, tec: Who, adm: Who;

async function client(name = 'Cliente Pedido') {
  const email = uniq('cli');
  const account = await userWith('CLIENTE', email);
  const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name, email } });
  return { account, customerId: c.json.id as number };
}
const portal = (path: string, who: { token: string }, opts: { method?: string; body?: object } = {}) => api(`/api/portal${path}`, { auth: who.token, ...opts });
const statusOf = async (id: number) => (await prisma.repair.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  [rec, tec, adm] = await Promise.all([userWith('RECEPCION'), userWith('TECNICO'), userWith('ADMIN')]);
});
beforeEach(() => {
  sent.length = 0;
});
afterAll(async () => {
  await cleanup(prisma, DOMAIN);
  server.close();
  await prisma.$disconnect();
});

describe('el cliente da de alta sus herramientas', () => {
  it('con texto libre; siempre quedan a su nombre aunque mande otro customerId', async () => {
    const a = await client('Ana');
    const b = await client('Beto');
    const t = await portal('/tools', a.account, { method: 'POST', body: { type: 'Taladro', brand: 'Bosch', model: 'GSB', customerId: b.customerId } });
    expect(t.status).toBe(201);
    expect((await prisma.tool.findUniqueOrThrow({ where: { id: t.json.id } })).customerId).toBe(a.customerId);
    expect((await portal('/tools', a.account)).json).toHaveLength(1);
    expect((await portal('/tools', b.account)).json).toHaveLength(0);
  });

  it('elige del catálogo, que puede leer; sin datos suficientes responde 400', async () => {
    const a = await client();
    const cat = (await portal('/catalogs', a.account)).json;
    expect(cat).toHaveProperty('models');
    expect((await portal('/tools', a.account, { method: 'POST', body: { type: 'x' } })).status).toBe(400);
    const brand = (await api('/api/catalogs/brands', { method: 'POST', auth: adm.token, body: { name: `ZR${Date.now().toString(36)}` } })).json;
    const type = (await api('/api/catalogs/types', { method: 'POST', auth: adm.token, body: { name: `ZT${Date.now().toString(36)}` } })).json;
    const model = (await api('/api/catalogs/models', { method: 'POST', auth: adm.token, body: { name: 'M1', brandId: brand.id, toolTypeId: type.id } })).json;
    const t = await portal('/tools', a.account, { method: 'POST', body: { modelId: model.id } });
    expect(t.status).toBe(201);
    expect(t.json).toMatchObject({ brand: brand.name, type: type.name, model: 'M1' });
    // limpieza del catálogo de prueba
    await prisma.tool.deleteMany({ where: { modelId: model.id } });
    await prisma.toolModel.delete({ where: { id: model.id } });
    await prisma.brand.delete({ where: { id: brand.id } });
    await prisma.toolType.delete({ where: { id: type.id } });
  });

  it('el personal no usa estas rutas (403)', async () => {
    expect((await portal('/tools', rec)).status).toBe(403);
    expect((await portal('/repairs', adm, { method: 'POST', body: { toolId: 1, declaredFault: 'x' } })).status).toBe(403);
  });
});

describe('el cliente pide una reparación', () => {
  async function requested() {
    const a = await client();
    const t = (await portal('/tools', a.account, { method: 'POST', body: { type: 'Amoladora', brand: 'Makita', model: 'GA5' } })).json;
    const r = await portal('/repairs', a.account, { method: 'POST', body: { toolId: t.id, declaredFault: 'Hace chispas', notes: 'La compré en 2023' } });
    return { a, t, r };
  }

  it('entra como SOLICITADA, requiere presupuesto, queda auditada y avisa por correo', async () => {
    const { a, r } = await requested();
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: 'SOLICITADA' });
    const rep = await prisma.repair.findUniqueOrThrow({ where: { id: r.json.id }, include: { history: true } });
    expect(rep).toMatchObject({ status: 'SOLICITADA', requiresQuote: true, inWarranty: false, customerId: a.customerId, receivedById: a.account.id });
    expect(rep.history).toHaveLength(1);
    expect(rep.history[0]).toMatchObject({ toStatus: 'SOLICITADA', origin: 'CUSTOMER_PORTAL' });
    expect(await prisma.auditLog.count({ where: { action: 'REPAIR_REQUESTED', entityId: String(rep.id) } })).toBe(1);
    expect(sent.find((m) => m.type === 'REPAIR_REQUESTED')).toMatchObject({ to: a.account.email });
    // aparece en su lista
    const list = (await portal('/repairs', a.account)).json as { id: number; status: string; active: boolean }[];
    expect(list.find((x) => x.id === r.json.id)).toMatchObject({ status: 'SOLICITADA', active: true });
  });

  it('no se puede pedir sobre la herramienta de otro cliente ni sobre una inexistente (404)', async () => {
    const { t } = await requested();
    const other = await client('Otro');
    expect((await portal('/repairs', other.account, { method: 'POST', body: { toolId: t.id, declaredFault: 'Roto' } })).status).toBe(404);
    expect((await portal('/repairs', other.account, { method: 'POST', body: { toolId: 99999999, declaredFault: 'Roto' } })).status).toBe(404);
    expect((await portal('/repairs', other.account, { method: 'POST', body: { toolId: t.id, declaredFault: '' } })).status).toBe(400);
  });

  it('no puede fijar su propio estado ni saltarse el presupuesto: esos campos se ignoran', async () => {
    const a = await client();
    const t = (await portal('/tools', a.account, { method: 'POST', body: { type: 'T', brand: 'B', model: 'M' } })).json;
    const r = await portal('/repairs', a.account, { method: 'POST', body: { toolId: t.id, declaredFault: 'Falla', status: 'EN_REPARACION', requiresQuote: false, inWarranty: true } });
    expect(r.status).toBe(201);
    expect(await prisma.repair.findUniqueOrThrow({ where: { id: r.json.id } })).toMatchObject({ status: 'SOLICITADA', requiresQuote: true, inWarranty: false });
  });

  it('puede cancelar su solicitud mientras no la reciba el taller; luego no', async () => {
    const { a, r } = await requested();
    expect((await portal(`/repairs/${r.json.id}/cancel`, a.account, { method: 'POST' })).json).toMatchObject({ status: 'CANCELADO' });
    expect(await statusOf(r.json.id)).toBe('CANCELADO');
    expect((await portal(`/repairs/${r.json.id}/cancel`, a.account, { method: 'POST' })).status).toBe(409);

    const second = await requested();
    await api(`/api/repairs/${second.r.json.id}/transition`, { method: 'POST', auth: rec.token, body: { to: 'RECIBIDO', reception: { visualState: 'Bien' } } });
    expect((await portal(`/repairs/${second.r.json.id}/cancel`, second.a.account, { method: 'POST' })).status).toBe(403); // ya no es una solicitud: solo lo cancela el taller
    expect(await statusOf(second.r.json.id)).toBe('RECIBIDO');
  });

  it('no puede cancelar la solicitud de otro cliente (404)', async () => {
    const { r } = await requested();
    const other = await client('Intruso');
    expect((await portal(`/repairs/${r.json.id}/cancel`, other.account, { method: 'POST' })).status).toBe(404);
    expect(await statusOf(r.json.id)).toBe('SOLICITADA');
  });
});

describe('el taller recibe la solicitud', () => {
  it('solo recepción y administración la pasan a Recibido, anotando el estado visual', async () => {
    const a = await client();
    const t = (await portal('/tools', a.account, { method: 'POST', body: { type: 'T', brand: 'B', model: 'M' } })).json;
    const id = (await portal('/repairs', a.account, { method: 'POST', body: { toolId: t.id, declaredFault: 'Falla' } })).json.id as number;

    expect((await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'RECIBIDO' } })).status).toBe(403); // un técnico no
    expect((await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } })).status).toBe(409); // no se salta la recepción
    expect((await api(`/api/repairs/${id}`, { auth: rec.token })).json.allowedTransitions.map((x: { to: string }) => x.to)).toEqual(expect.arrayContaining(['RECIBIDO', 'CANCELADO']));

    const ok = await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: rec.token, body: { to: 'RECIBIDO', reception: { visualState: 'Carcasa rota', accessories: 'Cargador' } } });
    expect(ok.status).toBe(200);
    expect(await prisma.repair.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'RECIBIDO', visualState: 'Carcasa rota', accessories: 'Cargador' });
    // a partir de aquí sigue el flujo normal
    expect((await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } })).status).toBe(200);
  });

  it('una solicitud no puede aprobarse ni empezarse sin pasar por la recepción', async () => {
    const a = await client();
    const t = (await portal('/tools', a.account, { method: 'POST', body: { type: 'T', brand: 'B', model: 'M' } })).json;
    const id = (await portal('/repairs', a.account, { method: 'POST', body: { toolId: t.id, declaredFault: 'Falla' } })).json.id as number;
    for (const to of ['EN_REPARACION', 'PRESUPUESTO_APROBADO', 'LISTO_PARA_RETIRAR']) {
      expect((await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: adm.token, body: { to } })).status, to).toBe(409);
    }
    expect((await portal(`/repairs/${id}/quote/decision`, a.account, { method: 'POST', body: { decision: 'APPROVE' } })).status).toBeGreaterThanOrEqual(400);
    expect(await statusOf(id)).toBe('SOLICITADA');
  });
});
