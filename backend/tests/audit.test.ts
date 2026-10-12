import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const sent: { to: string; type: string; html: string }[] = [];
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

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@aud.local';
const uniq = (p = 'a') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

async function api(path: string, opts: { method?: string; body?: object; auth?: string; cookie?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

async function userWith(role: string, status: 'ACTIVE' | 'DISABLED' | 'PENDING_EMAIL_VERIFICATION' = 'ACTIVE') {
  const email = uniq(role.toLowerCase());
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const u = await prisma.user.create({
    data: { email, firstName: 'Aud', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status, emailVerifiedAt: status === 'ACTIVE' ? new Date() : null },
  });
  const login = status === 'ACTIVE' ? await api('/api/auth/login', { method: 'POST', body: { email, password: PW } }) : null;
  return { id: u.id, email, token: login?.json?.accessToken as string, cookie: login?.cookie };
}

type Staff = Awaited<ReturnType<typeof userWith>>;
let adm: Staff, rec: Staff, tec: Staff, cli: Staff;

const audit = (qs: string, who: { token: string } = adm) => api(`/api/audit?${qs}`, { auth: who.token });
const actionsFor = async (entity: string, entityId: string | number) =>
  (await prisma.auditLog.findMany({ where: { entity, entityId: String(entityId) }, orderBy: { id: 'asc' } })).map((a) => a.action);

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  [adm, rec, tec, cli] = await Promise.all([userWith('ADMIN'), userWith('RECEPCION'), userWith('TECNICO'), userWith('CLIENTE')]);
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await cleanup(prisma, DOMAIN);
  await prisma.auditLog.deleteMany({ where: { entity: { startsWith: 'TestEntity' } } });
  server.close();
  await prisma.$disconnect();
});

describe('consulta', () => {
  it('solo ADMIN; anónimo 401', async () => {
    expect((await api('/api/audit')).status).toBe(401);
    for (const who of [rec, tec, cli]) {
      expect((await audit('', who)).status).toBe(403);
      expect((await api('/api/audit/actions', { auth: who.token })).status).toBe(403);
    }
    expect((await audit('')).status).toBe(200);
  });

  it('no existe forma de modificar ni borrar la auditoría', async () => {
    const row = await prisma.auditLog.create({ data: { action: 'X', entity: 'TestEntity-inmutable' } });
    for (const m of ['PUT', 'PATCH', 'DELETE', 'POST']) {
      const r = await api(`/api/audit/${row.id}`, { method: m, auth: adm.token, body: {} });
      expect([404, 405], m).toContain(r.status);
    }
    expect(await prisma.auditLog.count({ where: { id: row.id } })).toBe(1);
  });

  it('filtra por entidad, acción, usuario y devuelve el nombre del usuario', async () => {
    const entity = `TestEntity-${Date.now()}`;
    await prisma.auditLog.createMany({
      data: [
        { action: 'A1', entity, entityId: '1', userId: rec.id }, { action: 'A2', entity, entityId: '1', userId: tec.id },
        { action: 'A1', entity, entityId: '2', userId: rec.id }, { action: 'A3', entity, entityId: '2', userId: null },
      ],
    });
    const byEntity = await audit(`entity=${entity}`);
    expect(byEntity.json.items).toHaveLength(4);
    expect(byEntity.json.items.map((i: { action: string }) => i.action)).toEqual(['A3', 'A1', 'A2', 'A1']); // más nuevo primero

    expect((await audit(`entity=${entity}&entityId=1`)).json.items).toHaveLength(2);
    expect((await audit(`entity=${entity}&action=A1`)).json.items).toHaveLength(2);
    expect((await audit(`entity=${entity}&userId=${tec.id}`)).json.items).toHaveLength(1);

    const withUser = byEntity.json.items.find((i: { action: string; userId: number }) => i.action === 'A2');
    expect(withUser.user).toMatchObject({ id: tec.id, email: tec.email, firstName: 'Aud' });
    expect(byEntity.json.items.find((i: { action: string }) => i.action === 'A3').user).toBeNull();
    expect(JSON.stringify(withUser)).not.toContain('passwordHash');
  });

  it('filtra por rango de fechas incluyendo todo el día "hasta"', async () => {
    const entity = `TestEntity-fechas-${Date.now()}`;
    await prisma.auditLog.createMany({
      data: [
        { action: 'D', entity, createdAt: new Date('2020-03-10T08:00:00Z') },
        { action: 'D', entity, createdAt: new Date('2020-03-10T23:30:00Z') },
        { action: 'D', entity, createdAt: new Date('2020-03-11T00:10:00Z') },
        { action: 'D', entity, createdAt: new Date('2020-03-20T12:00:00Z') },
      ],
    });
    expect((await audit(`entity=${entity}&from=2020-03-10&to=2020-03-10`)).json.items).toHaveLength(2);
    expect((await audit(`entity=${entity}&from=2020-03-11`)).json.items).toHaveLength(2);
    expect((await audit(`entity=${entity}&to=2020-03-10`)).json.items).toHaveLength(2);
    expect((await audit(`entity=${entity}&from=2020-03-10&to=2020-03-20`)).json.items).toHaveLength(4);
    expect((await audit(`entity=${entity}&from=basura`)).json.items).toHaveLength(4); // fecha inválida: se ignora
  });

  it('pagina por cursor sin repetir ni saltar, y acota el tamaño de página', async () => {
    const entity = `TestEntity-pag-${Date.now()}`;
    await prisma.auditLog.createMany({ data: Array.from({ length: 7 }, (_, i) => ({ action: `P${i}`, entity })) });
    const seen: number[] = [];
    let cursor: number | null = null;
    let pages = 0;
    do {
      const res: { json: { items: { id: number }[]; nextCursor: number | null } } = await audit(`entity=${entity}&limit=3${cursor ? `&before=${cursor}` : ''}`);
      seen.push(...res.json.items.map((i) => i.id));
      cursor = res.json.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort((a, b) => b - a)).toEqual(seen);
    expect((await audit(`entity=${entity}&limit=100000`)).json.items.length).toBeLessThanOrEqual(200);
  });

  it('lista las acciones distintas para el filtro', async () => {
    const actions = (await api('/api/audit/actions', { auth: adm.token })).json as string[];
    expect(actions).toEqual([...actions].sort());
    expect(actions).toEqual(expect.arrayContaining(['LOGIN', 'REPAIR_CREATED']));
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe('autenticación relevante', () => {
  it('registra intentos fallidos con motivo e IP, sin guardar la contraseña', async () => {
    const stranger = uniq('nadie');
    await api('/api/auth/login', { method: 'POST', body: { email: stranger, password: 'SuperSecreta999' } });
    const bad = await userWith('CLIENTE');
    await api('/api/auth/login', { method: 'POST', body: { email: bad.email, password: 'incorrecta123' } });
    const off = await userWith('CLIENTE', 'DISABLED');
    await api('/api/auth/login', { method: 'POST', body: { email: off.email, password: PW } });
    const pending = await userWith('CLIENTE', 'PENDING_EMAIL_VERIFICATION');
    await api('/api/auth/login', { method: 'POST', body: { email: pending.email, password: PW } });

    const rows = (await audit('action=LOGIN_FAILED&limit=50')).json.items as { data: { email: string; reason: string }; ip: string; userId: number | null }[];
    const by = (email: string) => rows.find((r) => r.data.email === email)!;
    expect(by(stranger)).toMatchObject({ data: { reason: 'unknown_user' }, userId: null });
    expect(by(bad.email).data.reason).toBe('bad_password');
    expect(by(off.email).data.reason).toBe('disabled');
    expect(by(pending.email).data.reason).toBe('unverified');
    expect(by(stranger).ip).toBeTruthy();
    expect(JSON.stringify(rows)).not.toContain('SuperSecreta999');
    expect(JSON.stringify(rows)).not.toContain('incorrecta123');
  });

  it('registra el éxito (LOGIN) y la reutilización de una sesión ya rotada', async () => {
    const u = await userWith('CLIENTE');
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN', userId: u.id } })).toBe(1);
    const first = u.cookie!;
    const rotated = await api('/api/auth/refresh', { method: 'POST', cookie: first });
    expect(rotated.status).toBe(200);
    // Reutilización inmediata (p. ej. dos pestañas a la vez): se rechaza, pero no es un robo y no se audita ni se cierran las demás sesiones.
    expect((await api('/api/auth/refresh', { method: 'POST', cookie: first })).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_REUSE_DETECTED', userId: u.id } })).toBe(0);
    expect((await api('/api/auth/refresh', { method: 'POST', cookie: rotated.cookie })).status).toBe(200);
    // Reutilización tardía de un token ya rotado: posible robo → se audita y se cierran todas las sesiones.
    await prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } });
    expect((await api('/api/auth/refresh', { method: 'POST', cookie: first })).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'REFRESH_REUSE_DETECTED', userId: u.id } })).toBe(1);
    expect(await prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
  });
});

describe('IP en las acciones', () => {
  it('toda acción hecha por la API queda con la IP de la petición, sin pasarla a mano', async () => {
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Con IP', email: uniq('ip') } });
    const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
    const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'f', visualState: 'v' } });
    for (const [entity, id] of [['Customer', c.json.id], ['Tool', t.json.id], ['Repair', r.json.id]] as const) {
      const rows = await prisma.auditLog.findMany({ where: { entity, entityId: String(id) } });
      expect(rows.length, entity).toBeGreaterThan(0);
      for (const row of rows) expect(row.ip, `${entity} ${row.action}`).toBeTruthy();
    }
  });
});

describe('cobertura: el ciclo completo deja rastro de cada operación importante', () => {
  it('usuarios, clientes, herramientas, reparación, diagnóstico, presupuesto, decisión, repuestos, estados y entrega', async () => {
    // usuarios
    const invited = await api('/api/users', { method: 'POST', auth: adm.token, body: { firstName: 'N', lastName: 'U', email: uniq('inv'), role: 'TECNICO' } });
    await api(`/api/users/${invited.json.id}`, { method: 'PATCH', auth: adm.token, body: { status: 'DISABLED' } });
    expect(await actionsFor('User', invited.json.id)).toEqual(['USER_CREATED', 'USER_UPDATED']);

    // cliente + herramienta + reparación
    const email = uniq('ciclo');
    // El cliente decide con su usuario (RN-35): la cuenta existe antes y se vincula al crear la ficha.
    const clientRole = await prisma.role.findUniqueOrThrow({ where: { name: 'CLIENTE' } });
    await prisma.user.create({ data: { email, firstName: 'C', lastName: 'L', roleId: clientRole.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() } });
    const cliToken = (await api('/api/auth/login', { method: 'POST', body: { email, password: PW } })).json.accessToken as string;
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Ciclo', email } });
    await api(`/api/customers/${c.json.id}`, { method: 'PATCH', auth: rec.token, body: { phone: '600' } });
    const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
    await api(`/api/tools/${t.json.id}`, { method: 'PATCH', auth: rec.token, body: { model: 'M2' } });
    expect(await actionsFor('Customer', c.json.id)).toEqual(['CUSTOMER_CREATED', 'CUSTOMER_UPDATED']);
    expect(await actionsFor('Tool', t.json.id)).toEqual(['TOOL_CREATED', 'TOOL_UPDATED']);

    const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'f', visualState: 'v' } });
    const id = r.json.id;
    const go = (to: string, who: Staff = tec, comment?: string) => api(`/api/repairs/${id}/transition`, { method: 'POST', auth: who.token, body: { to, comment } });
    await go('EN_REVISION');
    await api(`/api/repairs/${id}/diagnosis`, { method: 'POST', auth: tec.token, body: { text: 'Diag', visibleToCustomer: true } });
    await api(`/api/repairs/${id}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'PART', description: 'x', quantity: 1, unitPrice: 5, taxRate: 21 }] } });
    await api(`/api/repairs/${id}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'PART', description: 'x', quantity: 2, unitPrice: 5, taxRate: 21 }] } });
    await api(`/api/repairs/${id}/quote/send`, { method: 'POST', auth: tec.token });
    await api(`/api/repairs/${id}/quote/resend-link`, { method: 'POST', auth: tec.token });
    await api(`/api/portal/repairs/${id}/quote/decision`, { method: 'POST', auth: cliToken, body: { decision: 'APPROVE' } });
    const part = await api(`/api/repairs/${id}/spare-parts`, { method: 'POST', auth: tec.token, body: { description: 'Rep', quantity: 1, cost: 1, price: 2 } });
    await api(`/api/spare-parts/${part.json.id}`, { method: 'PATCH', auth: tec.token, body: { quantity: 2 } });
    await api(`/api/spare-parts/${part.json.id}/status`, { method: 'POST', auth: tec.token, body: { to: 'CANCELADO' } });
    await go('EN_REPARACION'); await go('REPARADO'); await go('LISTO_PARA_RETIRAR'); await go('ENTREGADO', rec);

    const acts = await actionsFor('Repair', id);
    for (const expected of [
      'REPAIR_CREATED', 'DIAGNOSIS_ADDED', 'QUOTE_CREATED', 'QUOTE_UPDATED', 'QUOTE_SENT', 'QUOTE_LINK_RESENT', 'QUOTE_APPROVED',
      'SPARE_PART_ADDED', 'SPARE_PART_UPDATED', 'SPARE_PART_STATUS', 'REPAIR_STATUS_CHANGED',
    ]) expect(acts, expected).toContain(expected);

    // cada cambio de estado, incluida la ENTREGA, con quién lo hizo
    const changes = (await prisma.auditLog.findMany({ where: { entity: 'Repair', entityId: String(id), action: 'REPAIR_STATUS_CHANGED' }, orderBy: { id: 'asc' } }))
      .map((a) => ({ to: (a.data as { to: string }).to, by: a.userId }));
    expect(changes.map((x) => x.to)).toEqual(['EN_REVISION', 'PRESUPUESTO_PENDIENTE_APROBACION', 'PRESUPUESTO_APROBADO', 'EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR', 'ENTREGADO']);
    expect(changes.at(-1)!.by).toBe(rec.id);
    expect(changes.find((x) => x.to === 'PRESUPUESTO_APROBADO')!.by).toBeTruthy(); // lo decidió el cliente con su usuario (RN-35), no el personal
    expect([tec.id, rec.id, adm.id]).not.toContain(changes.find((x) => x.to === 'PRESUPUESTO_APROBADO')!.by);

    // y la consulta por entidad devuelve el historial completo para la pantalla del ADMIN
    const viaApi = await audit(`entity=Repair&entityId=${id}&limit=200`);
    expect(viaApi.json.items.length).toBe(acts.length);
  });

  it('las operaciones de cuenta quedan registradas: registro, confirmación y cambio de contraseña', async () => {
    const email = uniq('cuenta');
    await api('/api/auth/register', { method: 'POST', body: { firstName: 'C', lastName: 'U', email, password: PW, confirmPassword: PW } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const vt = decodeURIComponent(sent.find((m) => m.to === email)!.html.match(/token=([^"]+)"/)![1]);
    await api('/api/auth/verify-email', { method: 'POST', body: { token: vt, password: PW } });
    await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
    const rt = decodeURIComponent(sent.filter((m) => m.to === email).at(-1)!.html.match(/token=([^"]+)"/)![1]);
    await api('/api/auth/reset-password', { method: 'POST', body: { token: rt, password: 'NuevaClave123x', confirmPassword: 'NuevaClave123x' } });
    expect(await actionsFor('User', user.id)).toEqual(['REGISTER', 'EMAIL_VERIFIED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_CHANGED']);
  });
});
