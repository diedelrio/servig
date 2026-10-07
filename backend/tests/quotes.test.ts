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
const { computeLine, computeTotals } = await import('../src/lib/money.js');
const { expireDueQuotes } = await import('../src/modules/quotes/service.js');
const { transitionRepair } = await import('../src/modules/repairs/workflow.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@quo.local';
const uniq = (p = 'q') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

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

const LABOR = { type: 'LABOR', description: 'Mano de obra', quantity: 1.5, unitPrice: 40, taxRate: 21 };
const PART = { type: 'PART', description: 'Escobillas', quantity: 2, unitPrice: 12.35, taxRate: 21 };

/** Reparación en EN_REVISION lista para presupuestar. */
async function inReview(over: object = {}) {
  const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente Q', email: uniq('cli') } });
  const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'Taladro', brand: 'Bosch', model: 'Q1' } });
  const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'Falla', visualState: 'Ok', ...over } });
  await api(`/api/repairs/${r.json.id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
  return { id: r.json.id as number, customerEmail: c.json.email as string };
}

const put = (id: number, items: object[], who: Staff = tec, notes?: string) =>
  api(`/api/repairs/${id}/quote`, { method: 'PUT', auth: who.token, body: { items, notes } });
const send = (id: number, who: Staff = tec) => api(`/api/repairs/${id}/quote/send`, { method: 'POST', auth: who.token });
const withdraw = (id: number, comment = 'Error en el precio', who: Staff = tec) =>
  api(`/api/repairs/${id}/quote/withdraw`, { method: 'POST', auth: who.token, body: { comment } });
const newVersion = (id: number, who: Staff = tec) => api(`/api/repairs/${id}/quote/new-version`, { method: 'POST', auth: who.token });
const repairStatus = async (id: number) => (await prisma.repair.findUniqueOrThrow({ where: { id } })).status as RepairStatus;
const customerDecision = (id: number, to: 'PRESUPUESTO_APROBADO' | 'PRESUPUESTO_RECHAZADO') =>
  transitionRepair({ repairId: id, to, internal: true, actor: { userId: null, role: null, origin: 'CUSTOMER_LINK' } });

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

describe('aritmética monetaria', () => {
  it('calcula neto e IVA por línea con redondeo half-up y totales que cuadran', () => {
    const l = computeLine({ quantity: 3, unitPrice: 1.15, taxRate: 21 });
    expect(l.lineNet.toFixed(2)).toBe('3.45');
    expect(l.lineTax.toFixed(2)).toBe('0.72'); // 0,7245 → 0,72
    expect(computeLine({ quantity: 1, unitPrice: 0.5, taxRate: 21 }).lineTax.toFixed(2)).toBe('0.11'); // 0,105 → 0,11 (half-up)
    const t = computeTotals([
      { quantity: 1.5, unitPrice: 40, taxRate: 21 },
      { quantity: 2, unitPrice: 12.35, taxRate: 21 },
    ]);
    expect(t.subtotal.toFixed(2)).toBe('84.70'); // 60,00 + 24,70
    expect(t.taxTotal.toFixed(2)).toBe('17.79'); // 12,60 + 5,19 (5,187 → 5,19)
    expect(t.total.toFixed(2)).toBe('102.49');
  });

  it('no sufre errores de coma flotante', () => {
    const t = computeTotals(Array.from({ length: 10 }, () => ({ quantity: 1, unitPrice: 0.1, taxRate: 0 })));
    expect(t.total.toFixed(2)).toBe('1.00'); // 0.1 * 10 en float da 0.9999999999999999
    expect(computeLine({ quantity: 3, unitPrice: 0.1, taxRate: 0 }).lineNet.toFixed(2)).toBe('0.30');
  });
});

describe('borrador', () => {
  it('crea v1 con líneas y totales calculados por el servidor', async () => {
    const r = await inReview();
    const res = await put(r.id, [LABOR, PART], tec, 'Incluye prueba final');
    expect(res.status).toBe(200);
    const q = res.json.quote;
    expect(q).toMatchObject({ currentVersion: 1, status: 'BORRADOR' });
    expect(q.versions[0]).toMatchObject({ version: 1, subtotal: '84.70', taxTotal: '17.79', total: '102.49', notes: 'Incluye prueba final' });
    expect(q.versions[0].items.map((i: { lineNet: string }) => i.lineNet)).toEqual(['60.00', '24.70']);
    expect(res.json.defaultTaxRate).toBe(21);
  });

  it('el cliente no puede falsear totales: se ignoran los enviados', async () => {
    const r = await inReview();
    const res = await api(`/api/repairs/${r.id}/quote`, { method: 'PUT', auth: tec.token, body: { items: [PART], total: 1, subtotal: 1 } });
    expect(res.json.quote.versions[0].total).toBe('29.89'); // 24,70 + 5,19
  });

  it('editar el borrador reemplaza las líneas (no duplica)', async () => {
    const r = await inReview();
    await put(r.id, [LABOR, PART]);
    const res = await put(r.id, [PART]);
    expect(res.json.quote.versions).toHaveLength(1);
    expect(res.json.quote.versions[0].items).toHaveLength(1);
    expect(await prisma.quoteItem.count({ where: { version: { quote: { repairId: r.id } } } })).toBe(1);
  });

  it('valida líneas: descripción, cantidad > 0, precio ≥ 0, decimales, IVA y tipo', async () => {
    const r = await inReview();
    const bad: object[] = [
      { ...LABOR, description: '' },
      { ...LABOR, quantity: 0 },
      { ...LABOR, quantity: -1 },
      { ...LABOR, unitPrice: -5 },
      { ...LABOR, unitPrice: 10.123 },
      { ...LABOR, taxRate: 150 },
      { ...LABOR, type: 'REGALO' },
    ];
    for (const b of bad) expect((await put(r.id, [b])).status, JSON.stringify(b)).toBe(400);
    expect((await put(r.id, [{ ...LABOR, taxRate: undefined }])).json.quote.versions[0].items[0].taxRate).toBe('21.00'); // IVA por defecto
  });

  it('solo se presupuesta en revisión', async () => {
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'C', email: uniq('x') } });
    const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
    const rep = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'f', visualState: 'v' } });
    const res = await put(rep.json.id, [LABOR]); // sigue RECIBIDO
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('NOT_IN_REVIEW');
  });

  it('permisos: TECNICO y ADMIN escriben; RECEPCION solo lee; CLIENTE y anónimo no', async () => {
    const r = await inReview();
    expect((await put(r.id, [LABOR], adm)).status).toBe(200);
    expect((await put(r.id, [LABOR], rec)).status).toBe(403);
    expect((await put(r.id, [LABOR], cli)).status).toBe(403);
    expect((await api(`/api/repairs/${r.id}/quote`, { method: 'PUT', body: { items: [] } })).status).toBe(401);
    expect((await api(`/api/repairs/${r.id}/quote`, { auth: rec.token })).status).toBe(200);
    expect((await api(`/api/repairs/${r.id}/quote`, { auth: cli.token })).status).toBe(403);
    expect((await send(r.id, rec)).status).toBe(403);
    expect((await api(`/api/repairs/999999999/quote`, { auth: tec.token })).status).toBe(404);
  });

  it('sin presupuesto devuelve quote null con la configuración', async () => {
    const r = await inReview();
    const res = await api(`/api/repairs/${r.id}/quote`, { auth: tec.token });
    expect(res.json).toMatchObject({ quote: null, defaultTaxRate: 21, validDays: 15 });
  });
});

describe('envío', () => {
  it('congela la versión, pasa la reparación a pendiente de aprobación y avisa al cliente', async () => {
    const r = await inReview();
    await put(r.id, [LABOR, PART]);
    const res = await send(r.id);
    expect(res.status).toBe(200);
    const v = res.json.quote.versions[0];
    expect(v.status).toBe('ENVIADO');
    expect(v.sentAt).toBeTruthy();
    const days = (new Date(v.validUntil).getTime() - new Date(v.sentAt).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(15);
    expect(await repairStatus(r.id)).toBe('PRESUPUESTO_PENDIENTE_APROBACION');

    const h = await prisma.repairStatusHistory.findFirstOrThrow({ where: { repairId: r.id, toStatus: 'PRESUPUESTO_PENDIENTE_APROBACION' } });
    expect(h).toMatchObject({ fromStatus: 'EN_REVISION', userId: tec.id, origin: 'STAFF' });
    expect(h.comment).toContain('v1');

    const mail = sent.find((m) => m.to === r.customerEmail && m.type === 'QUOTE_AVAILABLE')!;
    expect(mail.subject).toContain('Presupuesto disponible');
    expect(mail.html).toContain('102.49');
    expect(await prisma.auditLog.count({ where: { action: 'QUOTE_SENT', entityId: String(r.id) } })).toBe(1);
  });

  it('una versión enviada es inmutable: no se edita ni se reenvía', async () => {
    const r = await inReview();
    await put(r.id, [LABOR]);
    await send(r.id);
    const edit = await put(r.id, [PART]);
    expect(edit.status).toBe(409);
    expect(edit.json.code === 'NOT_IN_REVIEW' || edit.json.code === 'QUOTE_LOCKED').toBe(true);
    const again = await send(r.id);
    expect(again.status).toBe(409);
    const stored = await prisma.quoteItem.findMany({ where: { version: { quote: { repairId: r.id } } } });
    expect(stored).toHaveLength(1);
    expect(stored[0].description).toBe('Mano de obra');
  });

  it('exige al menos un concepto y no cambia nada si falla', async () => {
    const r = await inReview();
    expect((await send(r.id)).status).toBe(404); // sin presupuesto
    await put(r.id, []);
    const res = await send(r.id);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('EMPTY_QUOTE');
    expect(await repairStatus(r.id)).toBe('EN_REVISION');
    expect(sent.filter((m) => m.type === 'QUOTE_AVAILABLE')).toHaveLength(0);
  });

  it('es atómico: si la reparación no está en revisión, la versión sigue en borrador', async () => {
    const r = await inReview();
    await put(r.id, [LABOR]);
    await api(`/api/repairs/${r.id}/transition`, { method: 'POST', auth: adm.token, body: { to: 'CANCELADO', comment: 'cancelada' } });
    const res = await send(r.id);
    expect(res.status).toBe(409);
    const v = await prisma.quoteVersion.findFirstOrThrow({ where: { quote: { repairId: r.id } } });
    expect(v.status).toBe('BORRADOR');
    expect(v.sentAt).toBeNull();
    expect(sent.filter((m) => m.type === 'QUOTE_AVAILABLE')).toHaveLength(0);
  });

  it('doble envío simultáneo: se envía una sola vez', async () => {
    const r = await inReview();
    await put(r.id, [LABOR]);
    const [a, b] = await Promise.all([send(r.id), send(r.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(sent.filter((m) => m.type === 'QUOTE_AVAILABLE')).toHaveLength(1);
    expect(await prisma.repairStatusHistory.count({ where: { repairId: r.id, toStatus: 'PRESUPUESTO_PENDIENTE_APROBACION' } })).toBe(1);
  });

  it('un cliente sin email no puede recibir el presupuesto: se rechaza el envío y nada cambia', async () => {
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Sin mail', email: '' } });
    const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
    const rep = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'f', visualState: 'v' } });
    await api(`/api/repairs/${rep.json.id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
    await put(rep.json.id, [LABOR]);
    const res = await send(rep.json.id);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('CUSTOMER_EMAIL_REQUIRED');
    expect(await repairStatus(rep.json.id)).toBe('EN_REVISION');
    // al cargar el email en la ficha, ya se puede enviar
    await api(`/api/customers/${c.json.id}`, { method: 'PATCH', auth: rec.token, body: { email: uniq('nuevo') } });
    expect((await send(rep.json.id)).status).toBe(200);
  });
});

describe('versiones', () => {
  it('retirar → corregir en una versión nueva → reenviar; v1 queda intacta', async () => {
    const r = await inReview();
    await put(r.id, [LABOR, PART]);
    await send(r.id);

    expect((await newVersion(r.id)).status).toBe(409); // la versión enviada sigue en curso (y ni siquiera está en revisión)
    expect((await withdraw(r.id, '')).status).toBe(400); // motivo obligatorio
    const w = await withdraw(r.id);
    expect(w.status).toBe(200);
    expect(w.json.quote.status).toBe('CANCELADO');
    expect(await repairStatus(r.id)).toBe('EN_REVISION');
    const h = await prisma.repairStatusHistory.findFirstOrThrow({ where: { repairId: r.id, fromStatus: 'PRESUPUESTO_PENDIENTE_APROBACION', toStatus: 'EN_REVISION' } });
    expect(h.comment).toContain('Error en el precio');

    const nv = await newVersion(r.id);
    expect(nv.status).toBe(201);
    expect(nv.json.quote).toMatchObject({ currentVersion: 2, status: 'BORRADOR' });
    expect(nv.json.quote.versions[1].items).toHaveLength(2); // copia de las líneas

    const fixed = await put(r.id, [{ ...LABOR, unitPrice: 35 }, PART]);
    expect(fixed.json.quote.versions[1].total).not.toBe(fixed.json.quote.versions[0].total);
    expect(fixed.json.quote.versions[0]).toMatchObject({ status: 'CANCELADO', total: '102.49' }); // v1 no cambió
    expect(fixed.json.quote.versions[0].items[0].unitPrice).toBe('40.00');

    expect((await send(r.id)).status).toBe(200);
    expect(sent.filter((m) => m.type === 'QUOTE_AVAILABLE')).toHaveLength(2);
    const final = await api(`/api/repairs/${r.id}/quote`, { auth: tec.token });
    expect(final.json.quote.versions.map((v: { status: string }) => v.status)).toEqual(['CANCELADO', 'ENVIADO']);
  });

  it('tras un rechazo del cliente: revisión → nueva versión → reenvío', async () => {
    const r = await inReview();
    await put(r.id, [LABOR]);
    await send(r.id);
    await customerDecision(r.id, 'PRESUPUESTO_RECHAZADO');
    // el estado de la versión lo fijará la Fase 7; aquí se simula
    await prisma.quoteVersion.updateMany({ where: { quote: { repairId: r.id } }, data: { status: 'RECHAZADO' } });

    expect((await newVersion(r.id)).status).toBe(409); // todavía PRESUPUESTO_RECHAZADO, no en revisión
    await api(`/api/repairs/${r.id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
    expect((await newVersion(r.id)).status).toBe(201);
    expect((await send(r.id)).status).toBe(200);
    expect(await repairStatus(r.id)).toBe('PRESUPUESTO_PENDIENTE_APROBACION');
  });

  it('no se retira lo que no está enviado', async () => {
    const r = await inReview();
    await put(r.id, [LABOR]);
    const w = await withdraw(r.id);
    expect(w.status).toBe(409);
    expect(w.json.code).toBe('NOTHING_TO_WITHDRAW');
    expect((await withdraw(999999999)).status).toBe(404);
  });

  it('no se retira un presupuesto ya aprobado (la reparación ya no está pendiente)', async () => {
    const r = await inReview();
    await put(r.id, [LABOR]);
    await send(r.id);
    await customerDecision(r.id, 'PRESUPUESTO_APROBADO');
    const w = await withdraw(r.id);
    expect(w.status).toBe(409);
    expect(await repairStatus(r.id)).toBe('PRESUPUESTO_APROBADO');
    const v = await prisma.quoteVersion.findFirstOrThrow({ where: { quote: { repairId: r.id } } });
    expect(v.status).toBe('ENVIADO'); // la transacción revirtió el cambio de la versión
  });
});

describe('vencimiento', () => {
  it('lo enviado cuya validez pasó se marca VENCIDO y puede retirarse para rehacerlo', async () => {
    const r = await inReview();
    await put(r.id, [LABOR]);
    await send(r.id);
    await prisma.quoteVersion.updateMany({ where: { quote: { repairId: r.id } }, data: { validUntil: new Date(Date.now() - 1000) } });

    // El barrido es global: otro archivo de test puede haberlo ejecutado antes, así que se comprueba el resultado, no el conteo.
    await expireDueQuotes();
    const q = await api(`/api/repairs/${r.id}/quote`, { auth: tec.token });
    expect(q.json.quote.status).toBe('VENCIDO');

    expect((await withdraw(r.id, 'Venció sin respuesta')).status).toBe(200);
    expect((await newVersion(r.id)).status).toBe(201);
  });

  it('leer el presupuesto también actualiza los vencidos', async () => {
    const r = await inReview();
    await put(r.id, [LABOR]);
    await send(r.id);
    await prisma.quoteVersion.updateMany({ where: { quote: { repairId: r.id } }, data: { validUntil: new Date(Date.now() - 1000) } });
    expect((await api(`/api/repairs/${r.id}/quote`, { auth: rec.token })).json.quote.status).toBe('VENCIDO');
  });

  it('no toca lo que sigue vigente ni los borradores', async () => {
    const r = await inReview();
    await put(r.id, [LABOR]);
    await expireDueQuotes();
    expect((await api(`/api/repairs/${r.id}/quote`, { auth: tec.token })).json.quote.status).toBe('BORRADOR');
    await send(r.id);
    await expireDueQuotes();
    expect((await api(`/api/repairs/${r.id}/quote`, { auth: tec.token })).json.quote.status).toBe('ENVIADO');
  });
});

describe('diagnóstico', () => {
  it('TECNICO y ADMIN registran entradas con autor; se acumulan y respetan la visibilidad', async () => {
    const r = await inReview();
    const a = await api(`/api/repairs/${r.id}/diagnosis`, { method: 'POST', auth: tec.token, body: { text: 'Inducido quemado', visibleToCustomer: true } });
    expect(a.status).toBe(201);
    expect(a.json.visibleToCustomer).toBe(true);
    const b = await api(`/api/repairs/${r.id}/diagnosis`, { method: 'POST', auth: adm.token, body: { text: 'Nota interna' } });
    expect(b.json.visibleToCustomer).toBe(false); // por defecto, interno

    const d = await api(`/api/repairs/${r.id}`, { auth: rec.token });
    expect(d.json.diagnoses.map((x: { text: string }) => x.text)).toEqual(['Inducido quemado', 'Nota interna']);
    expect(d.json.diagnoses[0].author.lastName).toBe('TECNICO');
  });

  it('RECEPCION y CLIENTE no diagnostican; se valida el texto; no en reparaciones cerradas', async () => {
    const r = await inReview();
    const post = (who: Staff, body: object) => api(`/api/repairs/${r.id}/diagnosis`, { method: 'POST', auth: who.token, body });
    expect((await post(rec, { text: 'x' })).status).toBe(403);
    expect((await post(cli, { text: 'x' })).status).toBe(403);
    expect((await post(tec, { text: '   ' })).status).toBe(400);
    await api(`/api/repairs/${r.id}/transition`, { method: 'POST', auth: adm.token, body: { to: 'CANCELADO', comment: 'fin' } });
    expect((await post(tec, { text: 'tarde' })).status).toBe(409);
    expect((await api('/api/repairs/999999999/diagnosis', { method: 'POST', auth: tec.token, body: { text: 'x' } })).status).toBe(404);
  });
});
