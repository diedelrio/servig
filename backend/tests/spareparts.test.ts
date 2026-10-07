import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { RepairStatus } from '@prisma/client';

vi.mock('../src/lib/email.js', () => ({ sendEmail: vi.fn(async () => true) }));

const { cleanup } = await import('./cleanup.js');
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/security.js');
const { transitionRepair } = await import('../src/modules/repairs/workflow.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@sp.local';
const uniq = (p = 's') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

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
  const u = await prisma.user.create({
    data: { email, firstName: 'T', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json.accessToken as string };
}

type Staff = Awaited<ReturnType<typeof userWith>>;
let rec: Staff, tec: Staff, adm: Staff, cli: Staff;

const PART = { code: 'BR-123', description: 'Escobillas de carbón', supplier: 'Bosch', quantity: 2, cost: 4.5, price: 9.9 };

async function newRepair() {
  const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente SP', email: uniq('cli') } });
  const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'Taladro', brand: 'Bosch', model: 'SP' } });
  const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'f', visualState: 'v' } });
  return r.json.id as number;
}

const addPart = (repairId: number, body: object = PART, who: Staff = tec) =>
  api(`/api/repairs/${repairId}/spare-parts`, { method: 'POST', auth: who.token, body });
const setStatus = (partId: number, to: string, who: Staff = tec, date?: string) =>
  api(`/api/spare-parts/${partId}/status`, { method: 'POST', auth: who.token, body: { to, date } });
const list = (repairId: number, who: Staff = tec) => api(`/api/repairs/${repairId}/spare-parts`, { auth: who.token });
const statusOf = async (id: number) => (await prisma.repair.findUniqueOrThrow({ where: { id } })).status as RepairStatus;
const go = (id: number, to: string, who: Staff = tec) => api(`/api/repairs/${id}/transition`, { method: 'POST', auth: who.token, body: { to } });

/** Deja la reparación en PRESUPUESTO_APROBADO con un registro de aprobación real (como el flujo del cliente). */
async function approved() {
  const id = await newRepair();
  await go(id, 'EN_REVISION');
  const quote = await prisma.quote.create({ data: { repairId: id } });
  const v = await prisma.quoteVersion.create({ data: { quoteId: quote.id, version: 1, status: 'APROBADO', createdById: tec.id, sentById: tec.id } });
  await prisma.quoteApproval.create({ data: { versionId: v.id, decision: 'APROBADO', origin: 'CUSTOMER_LINK' } });
  await transitionRepair({ repairId: id, to: 'PRESUPUESTO_PENDIENTE_APROBACION', internal: true, actor: { userId: tec.id, role: 'TECNICO', origin: 'STAFF' } });
  await transitionRepair({ repairId: id, to: 'PRESUPUESTO_APROBADO', internal: true, actor: { userId: null, role: null, origin: 'CUSTOMER_LINK' } });
  return id;
}

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  [rec, tec, adm, cli] = await Promise.all([userWith('RECEPCION'), userWith('TECNICO'), userWith('ADMIN'), userWith('CLIENTE')]);
});

afterAll(async () => {
  await cleanup(prisma, DOMAIN);
  server.close();
  await prisma.$disconnect();
});

describe('alta y validación', () => {
  it('registra el repuesto en NECESARIO con importes exactos', async () => {
    const id = await newRepair();
    const res = await addPart(id);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ code: 'BR-123', description: 'Escobillas de carbón', supplier: 'Bosch', quantity: 2, cost: '4.50', price: '9.90', status: 'NECESARIO', orderedAt: null, receivedAt: null });
    expect(res.json.nextStatuses).toEqual(['SOLICITADO', 'CANCELADO']);
  });

  it('código y proveedor son opcionales; valida descripción, cantidad entera ≥ 1 y importes', async () => {
    const id = await newRepair();
    expect((await addPart(id, { description: 'Tornillo', quantity: 1, cost: 0, price: 0.5 })).status).toBe(201);
    const bad: object[] = [
      { ...PART, description: '' },
      { ...PART, quantity: 0 },
      { ...PART, quantity: 1.5 },
      { ...PART, cost: -1 },
      { ...PART, price: 3.333 },
      { ...PART, quantity: 99999 },
    ];
    for (const b of bad) expect((await addPart(id, b)).status, JSON.stringify(b)).toBe(400);
  });

  it('permisos: TECNICO y ADMIN escriben; RECEPCION solo lee; CLIENTE y anónimo no', async () => {
    const id = await newRepair();
    expect((await addPart(id, PART, adm)).status).toBe(201);
    expect((await addPart(id, PART, rec)).status).toBe(403);
    expect((await addPart(id, PART, cli)).status).toBe(403);
    expect((await list(id, rec)).status).toBe(200);
    expect((await list(id, cli)).status).toBe(403);
    expect((await api(`/api/repairs/${id}/spare-parts`)).status).toBe(401);
    const p = (await list(id)).json.parts[0];
    expect((await setStatus(p.id, 'SOLICITADO', rec)).status).toBe(403);
    expect((await api(`/api/spare-parts/${p.id}`, { method: 'PATCH', auth: rec.token, body: { quantity: 3 } })).status).toBe(403);
  });

  it('reparación o repuesto inexistente → 404', async () => {
    expect((await addPart(999999999)).status).toBe(404);
    expect((await list(999999999)).status).toBe(404);
    expect((await setStatus(999999999, 'SOLICITADO')).status).toBe(404);
  });
});

describe('flujo de estados del repuesto', () => {
  it('NECESARIO → SOLICITADO → PEDIDO_A_MARCA → RECIBIDO → INSTALADO, con fechas', async () => {
    const id = await newRepair();
    const p = (await addPart(id)).json;
    expect((await setStatus(p.id, 'SOLICITADO')).json.status).toBe('SOLICITADO');

    const today = new Date().toISOString().slice(0, 10);
    const ordered = await setStatus(p.id, 'PEDIDO_A_MARCA');
    expect(ordered.json).toMatchObject({ status: 'PEDIDO_A_MARCA', orderedAt: today, receivedAt: null });

    const received = await setStatus(p.id, 'RECIBIDO', tec, '2026-10-01');
    expect(received.json).toMatchObject({ status: 'RECIBIDO', receivedAt: '2026-10-01', orderedAt: today });

    const installed = await setStatus(p.id, 'INSTALADO');
    expect(installed.json.status).toBe('INSTALADO');
    expect(installed.json.nextStatuses).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: 'SPARE_PART_STATUS', entityId: String(id) } })).toBe(4);
  });

  it('no permite saltarse pasos ni volver atrás', async () => {
    const id = await newRepair();
    const p = (await addPart(id)).json;
    for (const to of ['PEDIDO_A_MARCA', 'RECIBIDO', 'INSTALADO']) {
      const r = await setStatus(p.id, to);
      expect(r.status, to).toBe(409);
      expect(r.json.code).toBe('INVALID_PART_TRANSITION');
    }
    await setStatus(p.id, 'SOLICITADO');
    expect((await setStatus(p.id, 'SOLICITADO')).status).toBe(409);
    expect((await api(`/api/spare-parts/${p.id}/status`, { method: 'POST', auth: tec.token, body: { to: 'NECESARIO' } })).status).toBe(400);
    expect((await api(`/api/spare-parts/${p.id}/status`, { method: 'POST', auth: tec.token, body: { to: 'SOLICITADO', date: 'ayer' } })).status).toBe(400);
  });

  it('se cancela desde cualquier estado no final; instalado y cancelado quedan cerrados', async () => {
    const id = await newRepair();
    const a = (await addPart(id)).json;
    const b = (await addPart(id)).json;
    expect((await setStatus(a.id, 'CANCELADO')).json.status).toBe('CANCELADO');
    await setStatus(b.id, 'SOLICITADO'); await setStatus(b.id, 'PEDIDO_A_MARCA'); await setStatus(b.id, 'RECIBIDO'); await setStatus(b.id, 'INSTALADO');
    for (const p of [a, b]) {
      expect((await setStatus(p.id, 'CANCELADO')).status).toBe(409);
      const upd = await api(`/api/spare-parts/${p.id}`, { method: 'PATCH', auth: tec.token, body: { quantity: 5 } });
      expect(upd.status).toBe(409);
      expect(upd.json.code).toBe('PART_CLOSED');
    }
  });

  it('dos cambios simultáneos desde el mismo estado: gana uno', async () => {
    const id = await newRepair();
    const p = (await addPart(id)).json;
    const [x, y] = await Promise.all([setStatus(p.id, 'SOLICITADO'), setStatus(p.id, 'CANCELADO')]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  });
});

describe('edición y totales', () => {
  it('edita campos de un repuesto abierto y puede vaciar los opcionales', async () => {
    const id = await newRepair();
    const p = (await addPart(id)).json;
    const upd = await api(`/api/spare-parts/${p.id}`, { method: 'PATCH', auth: tec.token, body: { quantity: 3, price: 12, supplier: '', code: '' } });
    expect(upd.status).toBe(200);
    expect(upd.json).toMatchObject({ quantity: 3, price: '12.00', supplier: null, code: null, cost: '4.50' });
  });

  it('el resumen suma coste y precio por cantidad, excluye cancelados y cuenta pendientes', async () => {
    const id = await newRepair();
    const a = (await addPart(id, { description: 'A', quantity: 2, cost: 4.5, price: 9.9 })).json;
    await addPart(id, { description: 'B', quantity: 1, cost: 10, price: 25.05 });
    const c = (await addPart(id, { description: 'C', quantity: 5, cost: 100, price: 200 })).json;
    await setStatus(c.id, 'CANCELADO');
    const r = await list(id);
    expect(r.json.summary).toEqual({ pending: 2, notInstalled: 2, totalCost: '19.00', totalPrice: '44.85' });
    await setStatus(a.id, 'SOLICITADO');
    expect((await list(id)).json.summary.pending).toBe(2); // SOLICITADO sigue pendiente
  });
});

describe('reparación cerrada', () => {
  it('no se agregan ni se modifican repuestos en una reparación cancelada', async () => {
    const id = await newRepair();
    const p = (await addPart(id)).json;
    await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: adm.token, body: { to: 'CANCELADO', comment: 'fin' } });
    const add = await addPart(id);
    expect(add.status).toBe(409);
    expect(add.json.code).toBe('REPAIR_CLOSED');
    expect((await setStatus(p.id, 'SOLICITADO')).status).toBe(409);
    expect((await api(`/api/spare-parts/${p.id}`, { method: 'PATCH', auth: tec.token, body: { quantity: 9 } })).status).toBe(409);
    expect((await list(id)).status).toBe(200); // pero sigue consultable
  });
});

describe('guardas en el workflow de la reparación', () => {
  it('pedir repuestos a la marca exige tener repuestos pendientes', async () => {
    const id = await approved();
    const res = await go(id, 'PEDIDO_REPUESTOS_MARCA');
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('NO_PENDING_PARTS');
    const d = await api(`/api/repairs/${id}`, { auth: tec.token });
    expect(d.json.allowedTransitions.map((a: { to: string }) => a.to)).not.toContain('PEDIDO_REPUESTOS_MARCA');

    await addPart(id);
    const d2 = await api(`/api/repairs/${id}`, { auth: tec.token });
    expect(d2.json.allowedTransitions.map((a: { to: string }) => a.to)).toContain('PEDIDO_REPUESTOS_MARCA');
    expect((await go(id, 'PEDIDO_REPUESTOS_MARCA')).status).toBe(200);
  });

  it('no se vuelve a reparar mientras falten repuestos; con todos recibidos o cancelados sí', async () => {
    const id = await approved();
    const a = (await addPart(id, { description: 'A', quantity: 1, cost: 1, price: 2 })).json;
    const b = (await addPart(id, { description: 'B', quantity: 1, cost: 1, price: 2 })).json;
    await go(id, 'PEDIDO_REPUESTOS_MARCA');

    const blocked = await go(id, 'EN_REPARACION');
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe('PARTS_PENDING');
    expect((await api(`/api/repairs/${id}`, { auth: tec.token })).json.allowedTransitions.map((x: { to: string }) => x.to)).not.toContain('EN_REPARACION');

    await setStatus(a.id, 'SOLICITADO'); await setStatus(a.id, 'PEDIDO_A_MARCA'); await setStatus(a.id, 'RECIBIDO');
    expect((await go(id, 'EN_REPARACION')).status).toBe(409); // B sigue pendiente
    await setStatus(b.id, 'CANCELADO'); // ya no hace falta
    expect((await go(id, 'EN_REPARACION')).status).toBe(200);
    expect(await statusOf(id)).toBe('EN_REPARACION');
  });

  it('seguir agregando repuestos durante la reparación es posible', async () => {
    const id = await approved();
    expect((await go(id, 'EN_REPARACION')).status).toBe(200); // sin repuestos, camino directo
    expect((await addPart(id)).status).toBe(201);
  });
});
