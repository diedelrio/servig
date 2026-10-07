import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { RepairStatus } from '@prisma/client';

const sent: { to: string; type: string; subject: string; html: string }[] = [];
vi.mock('../src/lib/email.js', () => ({
  sendEmail: vi.fn(async (m) => {
    sent.push(m);
    return true;
  }),
}));

const { cleanup } = await import('./cleanup.js');
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/security.js');
const { RULES, findRule, allowedFor, transitionRepair } = await import('../src/modules/repairs/workflow.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@wf.local';
const uniq = (p = 'w') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

const STATES: RepairStatus[] = [
  'RECIBIDO', 'EN_REVISION', 'PRESUPUESTO_PENDIENTE_APROBACION', 'PRESUPUESTO_APROBADO', 'PRESUPUESTO_RECHAZADO',
  'PEDIDO_REPUESTOS_MARCA', 'EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR', 'ENTREGADO', 'CANCELADO',
];

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

/** Crea una reparación nueva (RECIBIDO) vía API. */
async function newRepair(over: object = {}) {
  const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente WF', email: uniq('cli') } });
  const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'Sierra', brand: 'Dewalt', model: 'X1' } });
  const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'Falla', visualState: 'Ok', ...over } });
  return { id: r.json.id as number, customerEmail: c.json.email as string };
}

const go = (id: number, to: string, who: Staff, comment?: string) =>
  api(`/api/repairs/${id}/transition`, { method: 'POST', auth: who.token, body: { to, comment } });

const statusOf = async (id: number) => (await prisma.repair.findUniqueOrThrow({ where: { id } })).status;

/** Lleva una reparación a un estado de presupuesto como lo harán las Fases 6-7 (código interno). */
const internal = (id: number, to: RepairStatus, origin: 'STAFF' | 'CUSTOMER_LINK', who: Staff) =>
  transitionRepair({ repairId: id, to, internal: true, actor: { userId: origin === 'STAFF' ? who.id : null, role: origin === 'STAFF' ? 'TECNICO' : null, origin } });

/** Crea presupuesto + versión aprobada + registro de aprobación, y pasa la reparación a PRESUPUESTO_APROBADO como lo hace el flujo real. */
async function approveFixture(repairId: number) {
  const quote = await prisma.quote.create({ data: { repairId } });
  const v = await prisma.quoteVersion.create({ data: { quoteId: quote.id, version: 1, status: 'APROBADO', createdById: tec.id, sentById: tec.id } });
  await prisma.quoteApproval.create({ data: { versionId: v.id, decision: 'APROBADO', origin: 'CUSTOMER_LINK' } });
  await internal(repairId, 'PRESUPUESTO_APROBADO', 'CUSTOMER_LINK', tec);
}

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  [rec, tec, adm, cli] = await Promise.all([userWith('RECEPCION'), userWith('TECNICO'), userWith('ADMIN'), userWith('CLIENTE')]);
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await cleanup(prisma, DOMAIN);
  server.close();
  await prisma.$disconnect();
});

describe('matriz de transiciones (pura)', () => {
  it('permite exactamente las transiciones del doc 04 y ninguna más (121 pares)', () => {
    const allowed = new Set(RULES.map((r) => `${r.from}>${r.to}`));
    const expected = new Set([
      'RECIBIDO>EN_REVISION',
      'EN_REVISION>PRESUPUESTO_PENDIENTE_APROBACION',
      'PRESUPUESTO_PENDIENTE_APROBACION>EN_REVISION',
      'EN_REVISION>EN_REPARACION',
      'PRESUPUESTO_PENDIENTE_APROBACION>PRESUPUESTO_APROBADO',
      'PRESUPUESTO_PENDIENTE_APROBACION>PRESUPUESTO_RECHAZADO',
      'PRESUPUESTO_APROBADO>PEDIDO_REPUESTOS_MARCA',
      'PRESUPUESTO_APROBADO>EN_REPARACION',
      'PEDIDO_REPUESTOS_MARCA>EN_REPARACION',
      'PRESUPUESTO_RECHAZADO>EN_REVISION',
      'PRESUPUESTO_RECHAZADO>LISTO_PARA_RETIRAR',
      'EN_REPARACION>REPARADO',
      'REPARADO>LISTO_PARA_RETIRAR',
      'LISTO_PARA_RETIRAR>ENTREGADO',
      ...STATES.filter((s) => s !== 'ENTREGADO' && s !== 'CANCELADO').map((s) => `${s}>CANCELADO`),
    ]);
    expect(allowed).toEqual(expected);
    let pairs = 0;
    for (const a of STATES) for (const b of STATES) {
      pairs++;
      expect(!!findRule(a, b)).toBe(expected.has(`${a}>${b}`));
    }
    expect(pairs).toBe(121);
  });

  it('los estados finales no tienen salida', () => {
    for (const s of ['ENTREGADO', 'CANCELADO'] as const) expect(RULES.filter((r) => r.from === s)).toHaveLength(0);
  });

  it('RN-01: los estados de presupuesto solo los fijan reglas internas; el personal no puede', () => {
    for (const to of ['PRESUPUESTO_PENDIENTE_APROBACION', 'PRESUPUESTO_APROBADO', 'PRESUPUESTO_RECHAZADO'] as const) {
      const rules = RULES.filter((r) => r.to === to);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.every((r) => r.internal)).toBe(true);
    }
    // Y solo el cliente puede aprobar o rechazar
    for (const to of ['PRESUPUESTO_APROBADO', 'PRESUPUESTO_RECHAZADO'] as const) {
      expect(RULES.filter((r) => r.to === to).every((r) => r.actors.length === 1 && r.actors[0] === 'CUSTOMER')).toBe(true);
    }
  });

  it('RN-01: a EN_REPARACION solo se llega desde estados aprobados o, sin presupuesto, desde revisión', () => {
    const into = RULES.filter((r) => r.to === 'EN_REPARACION');
    expect(into.map((r) => r.from).sort()).toEqual(['EN_REVISION', 'PEDIDO_REPUESTOS_MARCA', 'PRESUPUESTO_APROBADO']);
    expect(into.find((r) => r.from === 'EN_REVISION')?.onlyIfNoQuote).toBe(true);
  });

  it('allowedFor devuelve las acciones por rol y oculta las internas y las de garantía si hay presupuesto', () => {
    expect(allowedFor({ status: 'RECIBIDO', requiresQuote: true }, 'TECNICO').map((a) => a.to)).toEqual(['EN_REVISION', 'CANCELADO'].slice(0, 1));
    expect(allowedFor({ status: 'RECIBIDO', requiresQuote: true }, 'RECEPCION').map((a) => a.to)).toEqual(['CANCELADO']);
    expect(allowedFor({ status: 'EN_REVISION', requiresQuote: true }, 'TECNICO').map((a) => a.to)).toEqual([]);
    expect(allowedFor({ status: 'EN_REVISION', requiresQuote: false }, 'TECNICO').map((a) => a.to)).toEqual(['EN_REPARACION']);
    expect(allowedFor({ status: 'PRESUPUESTO_PENDIENTE_APROBACION', requiresQuote: true }, 'ADMIN').map((a) => a.to)).toEqual(['CANCELADO']);
    expect(allowedFor({ status: 'ENTREGADO', requiresQuote: true }, 'ADMIN')).toEqual([]);
  });
});

describe('flujo con la API', () => {
  it('garantía sin presupuesto: RECIBIDO → … → ENTREGADO, con historial completo y correos', async () => {
    const r = await newRepair({ inWarranty: true, requiresQuote: false });
    const steps: [string, Staff, string?][] = [
      ['EN_REVISION', tec], ['EN_REPARACION', tec], ['REPARADO', tec], ['LISTO_PARA_RETIRAR', rec], ['ENTREGADO', rec, 'Retira el titular'],
    ];
    for (const [to, who, comment] of steps) {
      const res = await go(r.id, to, who, comment);
      expect(res.status, to).toBe(200);
      expect(res.json.status).toBe(to);
    }
    const h = await prisma.repairStatusHistory.findMany({ where: { repairId: r.id }, orderBy: { id: 'asc' } });
    expect(h.map((x) => x.toStatus)).toEqual(['RECIBIDO', 'EN_REVISION', 'EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR', 'ENTREGADO']);
    expect(h.map((x) => x.fromStatus)).toEqual([null, 'RECIBIDO', 'EN_REVISION', 'EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR']);
    expect(h[5]).toMatchObject({ userId: rec.id, comment: 'Retira el titular', origin: 'STAFF' });
    expect(h.every((x) => x.createdAt instanceof Date)).toBe(true);

    expect(sent.filter((m) => m.to === r.customerEmail).map((m) => m.type)).toEqual(['REPAIR_RECEIVED', 'REPAIR_FINISHED', 'REPAIR_READY']);
    expect(await prisma.auditLog.count({ where: { action: 'REPAIR_STATUS_CHANGED', entityId: String(r.id) } })).toBe(5);
  });

  it('RN-01: con presupuesto requerido no se puede empezar sin aprobación (ni siquiera ADMIN)', async () => {
    const r = await newRepair(); // requiresQuote = true
    await go(r.id, 'EN_REVISION', tec);
    for (const who of [tec, adm]) {
      const res = await go(r.id, 'EN_REPARACION', who);
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('QUOTE_REQUIRED');
    }
    // El personal tampoco puede fijar estados de presupuesto a mano
    for (const to of ['PRESUPUESTO_PENDIENTE_APROBACION', 'PRESUPUESTO_APROBADO']) {
      const res = await go(r.id, to, adm);
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('INVALID_TRANSITION');
    }
    expect(await statusOf(r.id)).toBe('EN_REVISION');
  });

  it('RN-01: tras la aprobación del cliente (flujo interno) sí se puede reparar', async () => {
    const r = await newRepair();
    await go(r.id, 'EN_REVISION', tec);
    await internal(r.id, 'PRESUPUESTO_PENDIENTE_APROBACION', 'STAFF', tec);
    // pendiente de aprobación: todavía no
    expect((await go(r.id, 'EN_REPARACION', tec)).status).toBe(409);
    await approveFixture(r.id);
    const ok = await go(r.id, 'EN_REPARACION', tec);
    expect(ok.status).toBe(200);
    const h = await prisma.repairStatusHistory.findFirstOrThrow({ where: { repairId: r.id, toStatus: 'PRESUPUESTO_APROBADO' } });
    expect(h).toMatchObject({ origin: 'CUSTOMER_LINK', userId: null });
  });

  it('RN-01 explícita: sin registro de aprobación de la última versión no se repara, aunque el estado diga "aprobado"', async () => {
    const r = await newRepair();
    await go(r.id, 'EN_REVISION', tec);
    await internal(r.id, 'PRESUPUESTO_PENDIENTE_APROBACION', 'STAFF', tec);
    await internal(r.id, 'PRESUPUESTO_APROBADO', 'CUSTOMER_LINK', tec); // estado forzado, sin Quote ni QuoteApproval
    for (const who of [tec, adm]) {
      const res = await go(r.id, 'EN_REPARACION', who);
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('QUOTE_REQUIRED');
    }
    expect(await statusOf(r.id)).toBe('PRESUPUESTO_APROBADO');
  });

  it('el personal no puede ejecutar por la API las transiciones internas, y el cliente no puede forzar otras', async () => {
    const r = await newRepair();
    await go(r.id, 'EN_REVISION', tec);
    await internal(r.id, 'PRESUPUESTO_PENDIENTE_APROBACION', 'STAFF', tec);
    expect((await go(r.id, 'PRESUPUESTO_APROBADO', adm)).status).toBe(409);
    // origen cliente solo puede las reglas de cliente
    await expect(transitionRepair({ repairId: r.id, to: 'CANCELADO', actor: { userId: null, role: null, origin: 'CUSTOMER_LINK' } })).rejects.toMatchObject({ status: 403 });
    // una regla interna sin el flag internal tampoco corre
    await expect(transitionRepair({ repairId: r.id, to: 'PRESUPUESTO_APROBADO', actor: { userId: null, role: null, origin: 'CUSTOMER_LINK' } })).rejects.toMatchObject({ status: 409 });
  });

  it('rechazo: puede volver a revisión o devolverse sin reparar (con comentario)', async () => {
    const r = await newRepair();
    await go(r.id, 'EN_REVISION', tec);
    await internal(r.id, 'PRESUPUESTO_PENDIENTE_APROBACION', 'STAFF', tec);
    await internal(r.id, 'PRESUPUESTO_RECHAZADO', 'CUSTOMER_LINK', tec);
    expect((await go(r.id, 'EN_REPARACION', tec)).status).toBe(409);
    expect((await go(r.id, 'LISTO_PARA_RETIRAR', tec)).json.code).toBe('COMMENT_REQUIRED');
    expect((await go(r.id, 'LISTO_PARA_RETIRAR', tec, 'Devolver sin reparar')).status).toBe(200);
    expect((await go(r.id, 'ENTREGADO', rec)).status).toBe(200);
  });

  it('rechazo → nueva revisión', async () => {
    const r = await newRepair();
    await go(r.id, 'EN_REVISION', tec);
    await internal(r.id, 'PRESUPUESTO_PENDIENTE_APROBACION', 'STAFF', tec);
    await internal(r.id, 'PRESUPUESTO_RECHAZADO', 'CUSTOMER_LINK', tec);
    expect((await go(r.id, 'EN_REVISION', tec)).status).toBe(200);
  });

  it('repuestos: aprobado → pedido a la marca → reparación', async () => {
    const r = await newRepair();
    await go(r.id, 'EN_REVISION', tec);
    await internal(r.id, 'PRESUPUESTO_PENDIENTE_APROBACION', 'STAFF', tec);
    await approveFixture(r.id);
    // Sin repuestos registrados no hay nada que pedir
    expect((await go(r.id, 'PEDIDO_REPUESTOS_MARCA', tec)).json.code).toBe('NO_PENDING_PARTS');
    const part = await prisma.repairSparePart.create({ data: { repairId: r.id, description: 'Escobillas', quantity: 1, cost: 2, price: 5, status: 'PEDIDO_A_MARCA', createdById: tec.id } });
    expect((await go(r.id, 'PEDIDO_REPUESTOS_MARCA', tec)).status).toBe(200);
    expect((await go(r.id, 'EN_REPARACION', tec)).json.code).toBe('PARTS_PENDING'); // todavía no llegaron
    await prisma.repairSparePart.update({ where: { id: part.id }, data: { status: 'RECIBIDO' } });
    expect((await go(r.id, 'EN_REPARACION', tec)).status).toBe(200);
  });
});

describe('permisos por rol', () => {
  it('cada rol solo hace lo suyo; CLIENTE y anónimo no pueden', async () => {
    const r = await newRepair({ inWarranty: true, requiresQuote: false });
    expect((await go(r.id, 'EN_REVISION', rec)).status).toBe(403); // RECEPCION no revisa
    expect((await go(r.id, 'EN_REVISION', cli)).status).toBe(403);
    expect((await api(`/api/repairs/${r.id}/transition`, { method: 'POST', body: { to: 'EN_REVISION' } })).status).toBe(401);
    expect(await statusOf(r.id)).toBe('RECIBIDO');

    await go(r.id, 'EN_REVISION', tec);
    await go(r.id, 'EN_REPARACION', tec);
    await go(r.id, 'REPARADO', tec);
    await go(r.id, 'LISTO_PARA_RETIRAR', tec);
    expect((await go(r.id, 'ENTREGADO', tec)).status).toBe(403); // el técnico no entrega
    expect((await go(r.id, 'ENTREGADO', adm)).status).toBe(200);
  });

  it('cancelar exige comentario y solo ADMIN o RECEPCION; no se cancela un estado final', async () => {
    const r = await newRepair();
    expect((await go(r.id, 'CANCELADO', tec, 'x')).status).toBe(403);
    expect((await go(r.id, 'CANCELADO', rec)).json.code).toBe('COMMENT_REQUIRED');
    expect((await go(r.id, 'CANCELADO', rec, '   ')).status).toBe(400); // solo espacios
    expect((await go(r.id, 'CANCELADO', rec, 'El cliente desistió')).status).toBe(200);
    expect((await go(r.id, 'CANCELADO', adm, 'otra vez')).status).toBe(409);
    expect((await go(r.id, 'EN_REVISION', tec)).status).toBe(409);
  });

  it('transición a un estado inexistente o reparación inexistente', async () => {
    const r = await newRepair();
    expect((await go(r.id, 'VOLANDO', tec)).status).toBe(400);
    expect((await go(999999999, 'EN_REVISION', tec)).status).toBe(404);
  });

  it('el detalle informa las acciones disponibles según el rol del usuario', async () => {
    const r = await newRepair();
    const forTec = await api(`/api/repairs/${r.id}`, { auth: tec.token });
    expect(forTec.json.allowedTransitions.map((a: { to: string }) => a.to)).toEqual(['EN_REVISION']);
    const forRec = await api(`/api/repairs/${r.id}`, { auth: rec.token });
    expect(forRec.json.allowedTransitions.map((a: { to: string }) => a.to)).toEqual(['CANCELADO']);
    expect(forRec.json.allowedTransitions[0].needsComment).toBe(true);
  });

  it('un cambio de rol se aplica al instante aunque el token conserve el rol anterior', async () => {
    const u = await userWith('TECNICO');
    const r = await newRepair();
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'RECEPCION' } });
    await prisma.user.update({ where: { id: u.id }, data: { roleId: adminRole.id } });
    expect((await go(r.id, 'EN_REVISION', u)).status).toBe(403); // ya no es técnico
  });
});

describe('concurrencia e integridad', () => {
  it('dos transiciones simultáneas desde el mismo estado: gana una, la otra recibe 409 y el historial queda coherente', async () => {
    const r = await newRepair();
    // Dos peticiones idénticas: sea cual sea el orden de llegada, solo una puede ganar.
    const [a, b] = await Promise.all([go(r.id, 'EN_REVISION', tec), go(r.id, 'EN_REVISION', adm)]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);
    const h = await prisma.repairStatusHistory.findMany({ where: { repairId: r.id }, orderBy: { id: 'asc' } });
    expect(h).toHaveLength(2);
    expect(h[1].fromStatus).toBe('RECIBIDO');
    expect(h[1].toStatus).toBe(await statusOf(r.id));
  });

  it('no existe ningún endpoint para editar o borrar el historial', async () => {
    const r = await newRepair();
    for (const m of ['PUT', 'PATCH', 'DELETE']) {
      expect([404, 405]).toContain((await api(`/api/repairs/${r.id}/history/1`, { method: m, auth: adm.token, body: {} })).status);
    }
  });
});
