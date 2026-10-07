import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { RepairStatus } from '@prisma/client';

vi.mock('../src/lib/email.js', () => ({ sendEmail: vi.fn(async () => true) }));

const { cleanup } = await import('./cleanup.js');
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/security.js');
const { dashboard, overdueIds } = await import('../src/modules/dashboard/service.js');
const { env } = await import('../src/lib/env.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@dash.local';
const uniq = (p = 'd') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;
const DAY = 86_400_000;

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
    data: { email, firstName: 'Dash', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json.accessToken as string };
}

type Staff = Awaited<ReturnType<typeof userWith>>;
let rec: Staff, tec: Staff, adm: Staff, cli: Staff;

/** Cliente único para poder acotar cada prueba a sus propios datos. */
async function customerWithTool(tag: string, taxId?: string) {
  const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: `Cliente ${tag}`, email: uniq('cli'), taxId, phone: `6${Math.floor(Math.random() * 1e8)}` } });
  const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'Taladro', brand: `Marca${tag}`, model: `Mod${tag}`, serialNumber: `SN-${tag}-${Math.floor(Math.random() * 1e6)}` } });
  return { customerId: c.json.id as number, toolId: t.json.id as number, tag };
}
/** Crea una reparación y la deja en `status` directamente (la matriz del workflow se prueba en otro archivo). */
async function repairIn(c: { customerId: number; toolId: number }, status: RepairStatus, over: { requiresQuote?: boolean; daysAgo?: number } = {}) {
  const r = await api('/api/repairs', {
    method: 'POST', auth: over.requiresQuote === false ? adm.token : rec.token, // omitir el presupuesto sin garantía registrada lo autoriza un ADMIN
    body: { toolId: c.toolId, declaredFault: 'f', visualState: 'v', ...(over.requiresQuote === false ? { inWarranty: true, requiresQuote: false } : {}) },
  });
  const id = r.json.id as number;
  await prisma.repair.update({ where: { id }, data: { status } });
  if (over.daysAgo !== undefined) {
    // simula "lleva N días en este estado": el último cambio de estado ocurrió hace N días
    await prisma.repairStatusHistory.updateMany({ where: { repairId: id }, data: { createdAt: new Date(Date.now() - over.daysAgo * DAY) } });
  }
  return id;
}
const scope = (customerId: number) => ({ customerId });

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

describe('contadores', () => {
  it('cuentan cada estado y ninguno de más', async () => {
    const c = await customerWithTool('cnt');
    const plan: [RepairStatus, number][] = [
      ['RECIBIDO', 2], ['EN_REVISION', 3], ['PRESUPUESTO_PENDIENTE_APROBACION', 1], ['PRESUPUESTO_APROBADO', 2],
      ['PEDIDO_REPUESTOS_MARCA', 1], ['EN_REPARACION', 4], ['LISTO_PARA_RETIRAR', 2], ['PRESUPUESTO_RECHAZADO', 1], ['REPARADO', 1],
      ['ENTREGADO', 3], ['CANCELADO', 2],
    ];
    for (const [status, n] of plan) for (let i = 0; i < n; i++) await repairIn(c, status);

    const { counts } = await dashboard(scope(c.customerId));
    expect(counts).toMatchObject({
      received: 2, inReview: 3, awaitingApproval: 1, approved: 2, awaitingParts: 1, inRepair: 4, readyForPickup: 2, rejected: 1, repaired: 1,
    });
  });

  it('"pendientes de presupuesto" son las que están en revisión y requieren presupuesto', async () => {
    const c = await customerWithTool('pq');
    await repairIn(c, 'EN_REVISION'); // requiere presupuesto (por defecto)
    await repairIn(c, 'EN_REVISION');
    await repairIn(c, 'EN_REVISION', { requiresQuote: false }); // garantía: no lo necesita
    await repairIn(c, 'RECIBIDO'); // todavía no se revisó
    const { counts } = await dashboard(scope(c.customerId));
    expect(counts.inReview).toBe(3);
    expect(counts.pendingQuote).toBe(2);
  });

  it('un universo vacío da todo en cero', async () => {
    const { counts, overdue } = await dashboard({ customerId: -1 });
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(overdue).toEqual([]);
  });
});

describe('atrasadas', () => {
  it('umbrales por defecto del taller', () => {
    expect(env.overdueDays).toMatchObject({
      RECIBIDO: 3, EN_REVISION: 3, PRESUPUESTO_PENDIENTE_APROBACION: 7, PEDIDO_REPUESTOS_MARCA: 7, EN_REPARACION: 5, LISTO_PARA_RETIRAR: 7,
    });
  });

  it('atrasada = más días en su estado que el umbral de ESE estado (estrictamente más)', async () => {
    const c = await customerWithTool('od');
    const a = await repairIn(c, 'EN_REPARACION', { daysAgo: 5.5 }); // umbral 5 → atrasada
    const b = await repairIn(c, 'EN_REPARACION', { daysAgo: 4.5 }); // dentro del plazo
    const d = await repairIn(c, 'PRESUPUESTO_PENDIENTE_APROBACION', { daysAgo: 6 }); // umbral 7 → bien
    const e = await repairIn(c, 'PRESUPUESTO_PENDIENTE_APROBACION', { daysAgo: 8 }); // atrasada
    const f = await repairIn(c, 'RECIBIDO', { daysAgo: 3.2 }); // umbral 3 → atrasada
    const g = await repairIn(c, 'RECIBIDO', { daysAgo: 0 });

    const ids = await overdueIds(scope(c.customerId));
    expect(new Set(ids)).toEqual(new Set([a, e, f]));
    for (const ok of [b, d, g]) expect(ids).not.toContain(ok);

    const dash = await dashboard(scope(c.customerId));
    expect(dash.counts.overdue).toBe(3);
    expect(dash.overdue.map((o) => o.id).sort()).toEqual([a, e, f].sort());
  });

  it('los estados finales nunca atrasan, por viejos que sean', async () => {
    const c = await customerWithTool('fin');
    await repairIn(c, 'ENTREGADO', { daysAgo: 400 });
    await repairIn(c, 'CANCELADO', { daysAgo: 400 });
    expect(await overdueIds(scope(c.customerId))).toEqual([]);
  });

  it('cuenta desde el ÚLTIMO cambio de estado, no desde la recepción', async () => {
    const c = await customerWithTool('desde');
    const id = await repairIn(c, 'EN_REPARACION', { daysAgo: 30 });
    // un cambio reciente de estado reinicia el reloj
    await prisma.repairStatusHistory.create({ data: { repairId: id, fromStatus: 'EN_REVISION', toStatus: 'EN_REPARACION', createdAt: new Date() } });
    expect(await overdueIds(scope(c.customerId))).toEqual([]);
  });

  it('ordena por cuánto se pasó del umbral e informa días, umbral y desde cuándo', async () => {
    const c = await customerWithTool('ord');
    const poco = await repairIn(c, 'EN_REPARACION', { daysAgo: 6.2 }); // +1.2 días
    const mucho = await repairIn(c, 'EN_REPARACION', { daysAgo: 20 }); // +15
    const dash = await dashboard(scope(c.customerId));
    expect(dash.overdue.map((o) => o.id)).toEqual([mucho, poco]);
    expect(dash.overdue[0]).toMatchObject({ number: expect.stringMatching(/^REP-/), status: 'EN_REPARACION', daysInStatus: 20, thresholdDays: 5, customerName: expect.stringContaining('ord') });
    expect(dash.overdue[0].since).toBeTruthy();
  });

  it('el umbral es configurable por estado con OVERDUE_DAYS', async () => {
    vi.resetModules();
    process.env.OVERDUE_DAYS = 'EN_REPARACION=10, RECIBIDO=1 ,INVENTADO=5,LISTO_PARA_RETIRAR=abc,REPARADO=-2';
    const { env: fresh } = await import('../src/lib/env.js');
    expect(fresh.overdueDays.EN_REPARACION).toBe(10);
    expect(fresh.overdueDays.RECIBIDO).toBe(1);
    expect(fresh.overdueDays.LISTO_PARA_RETIRAR).toBe(7); // valor inválido: se mantiene el de por defecto
    expect(fresh.overdueDays.REPARADO).toBe(3); // negativo: se ignora
    expect(fresh.overdueDays).not.toHaveProperty('INVENTADO');
    delete process.env.OVERDUE_DAYS;
  });
});

describe('API del dashboard', () => {
  it('lo ve el personal; el cliente y el anónimo no', async () => {
    expect((await api('/api/dashboard')).status).toBe(401);
    expect((await api('/api/dashboard', { auth: cli.token })).status).toBe(403);
    for (const who of [rec, tec, adm]) {
      const res = await api('/api/dashboard', { auth: who.token });
      expect(res.status).toBe(200);
      expect(Object.keys(res.json.counts).sort()).toEqual([
        'approved', 'awaitingApproval', 'awaitingParts', 'inRepair', 'inReview', 'overdue', 'pendingQuote', 'readyForPickup', 'received', 'rejected', 'repaired',
      ]);
      expect(res.json.thresholds.EN_REPARACION).toBeGreaterThan(0);
    }
  });
});

describe('filtros de la lista que enlazan con los contadores', () => {
  it('?filter=overdue y ?filter=pendingQuote devuelven exactamente esas reparaciones', async () => {
    const c = await customerWithTool('flt');
    const late = await repairIn(c, 'EN_REPARACION', { daysAgo: 9 });
    await repairIn(c, 'EN_REPARACION', { daysAgo: 1 });
    const pq = await repairIn(c, 'EN_REVISION');
    await repairIn(c, 'EN_REVISION', { requiresQuote: false });

    const search = encodeURIComponent(`Cliente flt`);
    const overdue = await api(`/api/repairs?filter=overdue&search=${search}`, { auth: rec.token });
    expect(overdue.json.map((r: { id: number }) => r.id)).toEqual([late]);
    const pending = await api(`/api/repairs?filter=pendingQuote&search=${search}`, { auth: rec.token });
    expect(pending.json.map((r: { id: number }) => r.id)).toEqual([pq]);
    // y combinan con el estado como cualquier otro filtro
    expect((await api(`/api/repairs?status=EN_REPARACION&search=${search}`, { auth: rec.token })).json).toHaveLength(2);
  });
});

describe('búsqueda global', () => {
  it('solo personal con permiso de lectura; cliente y anónimo no', async () => {
    expect((await api('/api/search?q=algo')).status).toBe(401);
    expect((await api('/api/search?q=algo', { auth: cli.token })).status).toBe(403);
    for (const who of [rec, tec, adm]) expect((await api('/api/search?q=algo', { auth: who.token })).status).toBe(200);
  });

  it('con menos de 2 caracteres no busca', async () => {
    const res = await api('/api/search?q=a', { auth: rec.token });
    expect(res.json).toMatchObject({ customers: [], repairs: [], tools: [] });
    expect((await api('/api/search', { auth: rec.token })).json.customers).toEqual([]);
  });

  it('encuentra por nombre, NIF, email, teléfono, número de reparación y serie, sin distinguir mayúsculas', async () => {
    const c = await customerWithTool('bsq', `Z${Math.floor(Math.random() * 1e7)}K`);
    const id = await repairIn(c, 'RECIBIDO');
    const rep = await prisma.repair.findUniqueOrThrow({ where: { id }, include: { customer: true, tool: true } });
    const find = async (q: string) => (await api(`/api/search?q=${encodeURIComponent(q)}`, { auth: tec.token })).json;

    expect((await find('CLIENTE BSQ')).customers.map((x: { id: number }) => x.id)).toContain(c.customerId);
    expect((await find(rep.customer.taxId!.toLowerCase())).customers.map((x: { id: number }) => x.id)).toContain(c.customerId);
    // Fragmento único del email (la parte aleatoria): un prefijo con la marca de tiempo coincidiría con muchos clientes.
    const uniquePart = rep.customer.email!.split('@')[0].split('-').pop()!;
    expect((await find(uniquePart)).customers.map((x: { id: number }) => x.id)).toContain(c.customerId);
    expect((await find(rep.customer.phone!)).customers.map((x: { id: number }) => x.id)).toContain(c.customerId);

    const byNumber = await find(rep.number);
    expect(byNumber.repairs.map((x: { id: number }) => x.id)).toEqual([id]);
    expect(byNumber.repairs[0]).toMatchObject({ number: rep.number, status: 'RECIBIDO', customerName: 'Cliente bsq' });
    expect((await find(rep.number.slice(-6))).repairs.map((x: { id: number }) => x.id)).toContain(id); // solo los dígitos finales

    const bySerial = await find(rep.tool.serialNumber!);
    expect(bySerial.tools[0]).toMatchObject({ customerId: c.customerId, serialNumber: rep.tool.serialNumber });
    expect(bySerial.repairs.map((x: { id: number }) => x.id)).toContain(id); // las reparaciones de esa herramienta también salen
  });

  it('limita los resultados y no devuelve datos sensibles ni observaciones', async () => {
    const tag = `lim${Date.now()}`;
    for (let i = 0; i < 11; i++) await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: `Cliente ${tag} ${i}`, notes: 'NOTA-PRIVADA', address: 'DIRECCION-PRIVADA' } });
    const res = await api(`/api/search?q=${tag}`, { auth: rec.token });
    expect(res.json.customers).toHaveLength(8);
    const raw = JSON.stringify(res.json);
    expect(raw).not.toContain('NOTA-PRIVADA');
    expect(raw).not.toContain('DIRECCION-PRIVADA');
    await prisma.customer.deleteMany({ where: { name: { contains: tag } } });
  });

  it('un texto con caracteres raros no rompe la consulta', async () => {
    for (const q of ["'; DROP TABLE \"Repair\";--", '%%', '_ _', '\\', '<script>']) {
      expect((await api(`/api/search?q=${encodeURIComponent(q)}`, { auth: rec.token })).status, q).toBe(200);
    }
  });

  it('el carácter nulo se rechaza con 400 en cualquier entrada (consulta o cuerpo), no con un 500', async () => {
    const q = await api(`/api/search?q=${encodeURIComponent('a\u0000b')}`, { auth: rec.token });
    expect(q.status).toBe(400);
    expect(q.json.code).toBe('INVALID_TEXT');
    const body = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente\u0000Malo' } });
    expect(body.status).toBe(400);
    const nested = await api('/api/repairs/1/diagnosis', { method: 'POST', auth: tec.token, body: { text: 'ok', extra: { x: ['\u0000'] } } });
    expect(nested.status).toBe(400);
    expect(await prisma.customer.count({ where: { name: { contains: 'Malo' } } })).toBe(0);
  });
});
