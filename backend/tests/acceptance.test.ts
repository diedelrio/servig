/**
 * Recorrido de aceptación del MVP: un único relato de punta a punta contra los criterios de docs/11-criterios-aceptacion.md.
 * No sustituye a las pruebas por módulo; comprueba que las piezas funcionan juntas como las usará el taller.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Correo REAL con un transporte falso: así se comprueba también el registro de correos (EmailLog).
const { cleanup } = await import('./cleanup.js');
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/security.js');
const { setTransport } = await import('../src/lib/email.js');
const { dashboard } = await import('../src/modules/dashboard/service.js');
import type { Mail } from '../src/lib/email.js';

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@acc.local';
const uniq = (p = 'a') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;
const inbox: Mail[] = [];

async function api(path: string, opts: { method?: string; body?: object; auth?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function staff(role: string) {
  const email = uniq(role.toLowerCase());
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const u = await prisma.user.create({ data: { email, firstName: role[0] + role.slice(1).toLowerCase(), lastName: 'Taller', roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json.accessToken as string };
}
type Person = Awaited<ReturnType<typeof staff>>;
const tokenIn = (to: string, type: string, re = /token=([^"]+)"/) => {
  const m = inbox.filter((x) => x.to === to && x.subject).reverse().find((x) => (type === 'verify' ? x.subject.includes('Confirma') : type === 'reset' ? x.subject.includes('Recupera') : x.subject.includes('Presupuesto disponible')));
  return decodeURIComponent(m!.html.match(re)![1]);
};

let adm: Person, rec: Person, tec: Person;
const stateOf = async (id: number) => (await prisma.repair.findUniqueOrThrow({ where: { id } })).status;
const go = (id: number, to: string, who: Person, comment?: string) => api(`/api/repairs/${id}/transition`, { method: 'POST', auth: who.token, body: { to, comment } });

beforeAll(async () => {
  setTransport({ send: async (m) => void inbox.push(m) });
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  [adm, rec, tec] = await Promise.all([staff('ADMIN'), staff('RECEPCION'), staff('TECNICO')]);
});
afterAll(async () => {
  await cleanup(prisma, DOMAIN);
  server.close();
  await prisma.$disconnect();
});

const J: {
  email: string; customerId: number; repairId: number; number: string; token: string; otherEmail: string; otherRepair: number; otherToken: string
} = {} as never;

describe('1-2. Un cliente se registra y su herramienta recorre todo el taller hasta la entrega', () => {
  it('registro → confirmación de email (enlace + contraseña) → acceso al portal', async () => {
    J.email = uniq('cliente');
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Ana Aceptación', email: J.email, phone: '600111222' } });
    J.customerId = c.json.id;

    expect((await api('/api/auth/register', { method: 'POST', body: { firstName: 'Ana', lastName: 'A', email: J.email, password: PW, confirmPassword: PW } })).status).toBe(202);
    expect((await api('/api/auth/login', { method: 'POST', body: { email: J.email, password: PW } })).status).toBe(403); // sin confirmar no entra
    const v = await api('/api/auth/verify-email', { method: 'POST', body: { token: tokenIn(J.email, 'verify'), password: PW } });
    expect(v.status).toBe(200);
    const login = await api('/api/auth/login', { method: 'POST', body: { email: J.email, password: PW } });
    expect(login.status).toBe(200);
    J.token = login.json.accessToken;
    expect(login.json.user).toMatchObject({ role: 'CLIENTE', customerId: J.customerId });
    expect((await api('/api/portal/repairs', { auth: J.token })).status).toBe(200);
  });

  it('recepción → resguardo → revisión → diagnóstico → presupuesto → aprobación del cliente en el portal → reparación → entrega', async () => {
    const tool = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: J.customerId, type: 'Amoladora', brand: 'Makita', model: '9557', serialNumber: 'ACC-001' } });
    const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: tool.json.id, declaredFault: 'No arranca', visualState: 'Carcasa rota', accessories: 'Disco y llave' } });
    expect(r.status).toBe(201);
    J.repairId = r.json.id;
    J.number = r.json.number;
    expect(J.number).toMatch(/^REP-\d{4}-\d{6}$/);
    expect(await stateOf(J.repairId)).toBe('RECIBIDO');

    expect((await go(J.repairId, 'EN_REVISION', tec)).status).toBe(200);
    await api(`/api/repairs/${J.repairId}/diagnosis`, { method: 'POST', auth: tec.token, body: { text: 'Inducido quemado', visibleToCustomer: true } });
    await api(`/api/repairs/${J.repairId}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'LABOR', description: 'Rebobinado', quantity: 1, unitPrice: 45, taxRate: 21 }, { type: 'PART', description: 'Escobillas', quantity: 2, unitPrice: 5, taxRate: 21 }] } });
    expect((await api(`/api/repairs/${J.repairId}/quote/send`, { method: 'POST', auth: tec.token })).status).toBe(200);
    expect(await stateOf(J.repairId)).toBe('PRESUPUESTO_PENDIENTE_APROBACION');

    // El cliente lo ve en su portal, con el diagnóstico visible y sin lo interno
    const seen = await api(`/api/portal/repairs/${J.repairId}`, { auth: J.token });
    expect(seen.json.quote).toMatchObject({ status: 'ENVIADO', canDecide: true, total: '66.55' }); // (45 + 10) × 1,21
    expect(seen.json.diagnoses).toHaveLength(1);

    // RN-01: hasta que el cliente aprueba, nadie del taller puede empezar
    for (const who of [tec, adm]) expect((await go(J.repairId, 'EN_REPARACION', who)).status).toBe(409);
    expect((await api(`/api/portal/repairs/${J.repairId}/quote/decision`, { method: 'POST', auth: J.token, body: { decision: 'APPROVE' } })).status).toBe(200);
    expect(await stateOf(J.repairId)).toBe('PRESUPUESTO_APROBADO');

    // repuestos y reparación
    const part = await api(`/api/repairs/${J.repairId}/spare-parts`, { method: 'POST', auth: tec.token, body: { description: 'Escobillas', quantity: 2, cost: 2, price: 5 } });
    expect((await go(J.repairId, 'PEDIDO_REPUESTOS_MARCA', tec)).status).toBe(200);
    for (const to of ['SOLICITADO', 'PEDIDO_A_MARCA', 'RECIBIDO', 'INSTALADO']) await api(`/api/spare-parts/${part.json.id}/status`, { method: 'POST', auth: tec.token, body: { to } });
    for (const [to, who] of [['EN_REPARACION', tec], ['REPARADO', tec], ['LISTO_PARA_RETIRAR', rec], ['ENTREGADO', rec]] as const) {
      expect((await go(J.repairId, to, who)).status, to).toBe(200);
    }
    expect(await stateOf(J.repairId)).toBe('ENTREGADO');
    const final = await api(`/api/portal/repairs/${J.repairId}`, { auth: J.token });
    expect(final.json.timeline.map((t: { status: string }) => t.status)).toEqual([
      'RECIBIDO', 'EN_REVISION', 'PRESUPUESTO_PENDIENTE_APROBACION', 'PRESUPUESTO_APROBADO', 'PEDIDO_REPUESTOS_MARCA', 'EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR', 'ENTREGADO',
    ]);
  });
});

describe('3. Ninguna llamada a la API consigue reparar sin la aprobación del cliente', () => {
  it('ni con todos los atajos imaginables', async () => {
    const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: J.customerId, type: 'Sierra', brand: 'Dewalt', model: 'S1' } });
    const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'f', visualState: 'v' } });
    const id = r.json.id as number;
    await go(id, 'EN_REVISION', tec);
    await api(`/api/repairs/${id}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'LABOR', description: 'x', quantity: 1, unitPrice: 10, taxRate: 21 }] } });
    await api(`/api/repairs/${id}/quote/send`, { method: 'POST', auth: tec.token });
    J.otherRepair = id;

    for (const to of ['EN_REPARACION', 'PRESUPUESTO_APROBADO', 'PEDIDO_REPUESTOS_MARCA', 'REPARADO', 'LISTO_PARA_RETIRAR', 'ENTREGADO']) {
      for (const who of [rec, tec, adm]) expect([403, 409], `${to} por ${who.email}`).toContain((await go(id, to, who)).status);
    }
    // el CLIENTE tampoco puede saltarse el proceso por las rutas del personal
    expect((await go(id, 'EN_REPARACION', { token: J.token } as Person)).status).toBe(403);
    // ni una aprobación falsa (token inventado) ni la de otro cliente
    expect((await api(`/api/public/quote-approval/${'x'.repeat(43)}/decision`, { method: 'POST', body: { decision: 'APPROVE' } })).status).toBe(404);
    expect(await stateOf(id)).toBe('PRESUPUESTO_PENDIENTE_APROBACION');
  });
});

describe('4. El historial y las decisiones se pueden consultar y no se pueden modificar', () => {
  it('queda cada cambio con quién, cuándo y origen; no hay forma de editarlos', async () => {
    const hist = await prisma.repairStatusHistory.findMany({ where: { repairId: J.repairId }, orderBy: { id: 'asc' } });
    expect(hist).toHaveLength(9);
    expect(hist[0]).toMatchObject({ fromStatus: null, toStatus: 'RECIBIDO', origin: 'STAFF' });
    expect(hist.find((h) => h.toStatus === 'PRESUPUESTO_APROBADO')).toMatchObject({ origin: 'CUSTOMER_PORTAL' });
    const approval = await prisma.quoteApproval.findFirstOrThrow({ where: { version: { quote: { repairId: J.repairId } } } });
    expect(approval).toMatchObject({ decision: 'APROBADO', origin: 'CUSTOMER_PORTAL' });
    expect(approval.ip).toBeTruthy();
    expect(approval.decidedAt).toBeInstanceOf(Date);

    for (const m of ['PUT', 'PATCH', 'DELETE']) {
      for (const path of [`/api/repairs/${J.repairId}/history`, `/api/repairs/${J.repairId}/history/1`, `/api/repairs/${J.repairId}/quote/approval`, '/api/audit/1']) {
        expect([404, 405], `${m} ${path}`).toContain((await api(path, { method: m, auth: adm.token, body: {} })).status);
      }
    }
    // y lo consulta quien corresponde
    expect((await api(`/api/audit?entity=Repair&entityId=${J.repairId}&limit=200`, { auth: adm.token })).json.items.length).toBeGreaterThan(10);
    expect((await api('/api/audit', { auth: rec.token })).status).toBe(403);
  });
});

describe('5. Todos los correos del documento se enviaron y quedaron registrados', () => {
  it('los de autenticación y los de reparaciones, con resultado', async () => {
    // recuperación de contraseña de la clienta (también ejercita AUTH_PASSWORD_RESET y AUTH_PASSWORD_CHANGED)
    await api('/api/auth/forgot-password', { method: 'POST', body: { email: J.email } });
    const NEW = 'NuevaClaveSegura456';
    expect((await api('/api/auth/reset-password', { method: 'POST', body: { token: tokenIn(J.email, 'reset'), password: NEW, confirmPassword: NEW } })).status).toBe(200);
    // reenvío de confirmación para una cuenta pendiente
    const pend = uniq('pend');
    await api('/api/auth/register', { method: 'POST', body: { firstName: 'P', lastName: 'P', email: pend, password: PW, confirmPassword: PW } });
    await prisma.emailVerificationToken.updateMany({ where: { user: { email: pend } }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await api('/api/auth/resend-verification', { method: 'POST', body: { email: pend } });

    const logs = await prisma.emailLog.findMany({ where: { OR: [{ to: J.email }, { to: pend }] } });
    const types = new Set(logs.map((l) => l.type));
    for (const t of ['AUTH_VERIFY_EMAIL', 'AUTH_PASSWORD_RESET', 'AUTH_PASSWORD_CHANGED', 'REPAIR_RECEIVED', 'QUOTE_AVAILABLE', 'QUOTE_APPROVED', 'REPAIR_FINISHED', 'REPAIR_READY']) {
      expect(types.has(t), t).toBe(true);
    }
    expect(logs.filter((l) => l.to === pend)).toHaveLength(2); // alta + reenvío
    expect(logs.every((l) => l.status === 'SENT' && l.attempts >= 1 && l.subject && l.createdAt)).toBe(true);
  });
});

describe('6-8. Seguridad de cuentas y datos', () => {
  it('login y recuperación no revelan si un email existe (misma respuesta)', async () => {
    const stranger = uniq('nadie');
    const known = await api('/api/auth/login', { method: 'POST', body: { email: J.email, password: 'incorrecta-123' } });
    const unknown = await api('/api/auth/login', { method: 'POST', body: { email: stranger, password: 'incorrecta-123' } });
    expect([known.status, known.json]).toEqual([unknown.status, unknown.json]);
    const f1 = await api('/api/auth/forgot-password', { method: 'POST', body: { email: J.email } });
    const f2 = await api('/api/auth/forgot-password', { method: 'POST', body: { email: stranger } });
    expect([f1.status, f1.json]).toEqual([f2.status, f2.json]);
    const r1 = await api('/api/auth/register', { method: 'POST', body: { firstName: 'X', lastName: 'Y', email: J.email, password: PW, confirmPassword: PW } });
    const r2 = await api('/api/auth/register', { method: 'POST', body: { firstName: 'X', lastName: 'Y', email: uniq('libre'), password: PW, confirmPassword: PW } });
    expect([r1.status, r1.json]).toEqual([r2.status, r2.json]);
  });

  it('un cliente no puede ver ni tocar nada de otro', async () => {
    J.otherEmail = uniq('otro');
    const o = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Otro Cliente', email: J.otherEmail } });
    await prisma.user.create({ data: { email: J.otherEmail, firstName: 'O', lastName: 'C', roleId: (await prisma.role.findUniqueOrThrow({ where: { name: 'CLIENTE' } })).id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date(), customerId: o.json.id } });
    J.otherToken = (await api('/api/auth/login', { method: 'POST', body: { email: J.otherEmail, password: PW } })).json.accessToken;
    expect((await api('/api/portal/repairs', { auth: J.otherToken })).json).toEqual([]);
    expect((await api(`/api/portal/repairs/${J.repairId}`, { auth: J.otherToken })).status).toBe(404);
    expect((await api(`/api/portal/repairs/${J.otherRepair}/quote/decision`, { method: 'POST', auth: J.otherToken, body: { decision: 'APPROVE' } })).status).toBe(404);
    expect(await stateOf(J.otherRepair)).toBe('PRESUPUESTO_PENDIENTE_APROBACION');
  });

  it('contraseñas con Argon2id, tokens solo como hash y nada sensible en el repositorio', async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { passwordHash: true } });
    expect(users.length).toBeGreaterThan(3);
    expect(users.every((u) => u.passwordHash.startsWith('$argon2id$'))).toBe(true);

    const rawVerify = tokenIn(J.email, 'verify');
    const stored = await prisma.emailVerificationToken.findMany({ where: { user: { email: J.email } } });
    expect(stored.every((s) => s.tokenHash !== rawVerify && /^[0-9a-f]{64}$/.test(s.tokenHash))).toBe(true);
    expect(await prisma.quoteLinkToken.findMany({ where: { version: { quote: { repairId: J.repairId } } } })).toSatisfy((rows: { tokenHash: string }[]) => rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash)));

    const root = join(process.cwd(), '..');
    const tracked = execSync('git ls-files', { cwd: root }).toString().split('\n').filter(Boolean);
    expect(tracked.filter((f) => /(^|\/)\.env$/.test(f))).toEqual([]);
    const secretLike = /(BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9a-zA-Z-]{10,}|sk_live_[0-9a-zA-Z]{10,})/;
    const offenders = tracked.filter(
      (f) => /\.(ts|tsx|js|json|md|yml|sh)$/.test(f) && !f.includes('package-lock') && existsSync(join(root, f)) && secretLike.test(readFileSync(join(root, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

describe('9-10. Resguardo y dashboard', () => {
  it('el resguardo tiene todo lo que se imprime', async () => {
    const d = (await api(`/api/repairs/${J.repairId}`, { auth: rec.token })).json;
    expect(d).toMatchObject({ number: J.number, declaredFault: 'No arranca', visualState: 'Carcasa rota', accessories: 'Disco y llave', inWarranty: false });
    expect(d.receivedAt).toBeTruthy();
    expect(d.receivedBy).toMatchObject({ firstName: 'Recepcion' });
    expect(d.customer).toMatchObject({ name: 'Ana Aceptación' });
    expect(d.tool).toMatchObject({ brand: 'Makita', model: '9557', serialNumber: 'ACC-001' });
    expect(d.business.name).toBeTruthy();
    expect(d.business.receiptTerms).toContain('aprobación');
  });

  it('el dashboard refleja el estado del taller', async () => {
    const { counts } = await dashboard({ customerId: J.customerId });
    expect(counts).toMatchObject({ awaitingApproval: 1, readyForPickup: 0, overdue: 0 }); // una entregada y una esperando respuesta
    expect(Object.keys(counts)).toHaveLength(11);
  });
});

describe('11. La batería de pruebas cubre lo que el documento exige', () => {
  it('existen pruebas de workflow, RN-01, tokens de un solo uso y autorización por rol', () => {
    const files = readdirSync(join(process.cwd(), 'tests'));
    for (const f of ['workflow.test.ts', 'approval.test.ts', 'auth.test.ts', 'users.test.ts', 'portal.test.ts', 'audit.test.ts', 'security.test.ts']) {
      expect(files, f).toContain(f);
    }
    expect(existsSync(join(process.cwd(), 'tests', 'acceptance.test.ts'))).toBe(true);
  });
});
