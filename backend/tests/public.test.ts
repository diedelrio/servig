import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const sent: { to: string; type: string; subject: string; html: string }[] = [];
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
const { hashPassword, hashToken } = await import('../src/lib/security.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@pub.local';
const uniq = (p = 'p') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

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
  const u = await prisma.user.create({ data: { email, firstName: 'Pub', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json.accessToken as string };
}
type Who = Awaited<ReturnType<typeof userWith>>;
let rec: Who, tec: Who, adm: Who;

const tokenIn = (type: string, to: string) => {
  const m = sent.filter((x) => x.type === type && x.to === to).at(-1);
  return m ? decodeURIComponent(m.html.match(/token=([^"]+)"/)![1]) : null;
};
const request = (email: string, over: object = {}) =>
  api('/api/public/requests', { method: 'POST', body: { name: 'Pedro Público', email, type: 'Taladro', brand: 'Bosch', model: 'GSB', declaredFault: 'No enciende', ...over } });
const confirm = (token: string) => api('/api/public/requests/confirm', { method: 'POST', body: { token } });

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

describe('número de resguardo del sistema contable', () => {
  async function repair() {
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente Conta', email: uniq('conta') } });
    const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
    return (await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'f', visualState: 'v' } })).json.id as number;
  }
  const put = (id: number, number: string | null, who: Who = rec) => api(`/api/repairs/${id}/accounting-receipt`, { method: 'PUT', auth: who.token, body: { number } });

  it('lo cargan ADMIN y RECEPCION; el técnico y el anónimo no', async () => {
    const id = await repair();
    expect((await put(id, 'R-1', tec)).status).toBe(403);
    expect((await api(`/api/repairs/${id}/accounting-receipt`, { method: 'PUT', body: { number: 'R-1' } })).status).toBe(401);
    expect((await put(id, 'R-100/2026')).status).toBe(200);
    expect((await put(id, 'R-101', adm)).status).toBe(200);
  });

  it('queda guardado, se ve en el detalle, se puede quitar y cada cambio se audita', async () => {
    const id = await repair();
    await put(id, '  A-7788  ');
    expect((await api(`/api/repairs/${id}`, { auth: tec.token })).json.accountingReceipt).toBe('A-7788');
    await put(id, 'A-7789');
    await put(id, 'A-7789'); // sin cambio: no audita de nuevo
    expect((await put(id, '')).json.accountingReceipt).toBeNull();
    const logs = await prisma.auditLog.findMany({ where: { action: 'REPAIR_ACCOUNTING_RECEIPT_SET', entityId: String(id) }, orderBy: { id: 'asc' } });
    expect(logs.map((l) => (l.data as { from: string | null; to: string | null }))).toEqual([
      { from: null, to: 'A-7788' }, { from: 'A-7788', to: 'A-7789' }, { from: 'A-7789', to: null },
    ]);
  });

  it('valida el largo y que la reparación exista; se puede buscar por él', async () => {
    const id = await repair();
    expect((await put(id, 'x'.repeat(41))).status).toBe(400);
    expect((await put(99999999, 'A')).status).toBe(404);
    const tag = `ZC${Date.now().toString(36)}`;
    await put(id, tag);
    expect((await api(`/api/repairs?search=${tag}`, { auth: rec.token })).json.map((r: { id: number }) => r.id)).toContain(id);
    expect((await api(`/api/search?q=${tag}`, { auth: rec.token })).json.repairs.map((r: { id: number }) => r.id)).toContain(id);
  });
});

describe('solicitud desde la web pública', () => {
  it('no crea nada hasta confirmar desde el correo; el correo no guarda el cuerpo (lleva un enlace)', async () => {
    const email = uniq('sol');
    const res = await request(email);
    expect(res.status).toBe(202);
    expect(await prisma.customer.count({ where: { email } })).toBe(0);
    expect(await prisma.repair.count({ where: { customer: { email } } })).toBe(0);
    const token = tokenIn('PUBLIC_REQUEST_CONFIRM', email)!;
    expect(token.length).toBeGreaterThanOrEqual(40);
    const row = await prisma.publicRequest.findFirstOrThrow({ where: { email } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);
  });

  it('al confirmar nace la ficha, la herramienta y la reparación SOLICITADA asociada al email, y llega el enlace de consulta', async () => {
    const email = uniq('conf');
    await request(email, { phone: '600111222' });
    const token = tokenIn('PUBLIC_REQUEST_CONFIRM', email)!;
    sent.length = 0;
    const ok = await confirm(token);
    expect(ok.status).toBe(200);
    expect(ok.json.number).toMatch(/^REP-\d{4}-\d{6}$/);
    const repair = await prisma.repair.findFirstOrThrow({ where: { number: ok.json.number }, include: { customer: true, tool: true, history: true } });
    expect(repair).toMatchObject({ status: 'SOLICITADA', requiresQuote: true, inWarranty: false, receivedById: null });
    expect(repair.customer).toMatchObject({ email, name: 'Pedro Público', phone: '600111222' });
    expect(repair.tool).toMatchObject({ type: 'Taladro', brand: 'Bosch', model: 'GSB' });
    expect(repair.history[0]).toMatchObject({ toStatus: 'SOLICITADA', origin: 'SYSTEM', userId: null });
    expect(await prisma.auditLog.count({ where: { action: 'REPAIR_REQUESTED', entityId: String(repair.id) } })).toBe(1);
    const mail = sent.find((m) => m.type === 'REPAIR_STATUS_LINK' && m.to === email)!;
    expect(mail.html).toContain(ok.json.number);
    expect(mail.html).toContain('/consulta?token=');
  });

  it('confirmar dos veces (o a la vez) no duplica nada', async () => {
    const email = uniq('dup');
    await request(email);
    const token = tokenIn('PUBLIC_REQUEST_CONFIRM', email)!;
    const [a, b] = await Promise.all([confirm(token), confirm(token)]);
    expect(a.json.number).toBe(b.json.number);
    const again = await confirm(token);
    expect(again.json).toMatchObject({ number: a.json.number, already: true });
    expect(await prisma.repair.count({ where: { customer: { email } } })).toBe(1);
    expect(await prisma.customer.count({ where: { email } })).toBe(1);
  });

  it('un token inventado da 404 y uno vencido 410, sin crear nada', async () => {
    expect((await confirm('x'.repeat(43))).status).toBe(404);
    const email = uniq('venc');
    await request(email);
    const token = tokenIn('PUBLIC_REQUEST_CONFIRM', email)!;
    await prisma.publicRequest.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await confirm(token);
    expect(res.status).toBe(410);
    expect(await prisma.customer.count({ where: { email } })).toBe(0);
  });

  it('si el email ya tiene ficha, la reparación va a esa ficha sin pisar sus datos; y si tiene cuenta, la ve en el portal', async () => {
    const email = uniq('exist');
    const account = await userWith('CLIENTE', email);
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Nombre Original', email, phone: '611' } });
    await request(email, { name: 'Otro Nombre', phone: '999' });
    const ok = await confirm(tokenIn('PUBLIC_REQUEST_CONFIRM', email)!);
    const repair = await prisma.repair.findFirstOrThrow({ where: { number: ok.json.number }, include: { customer: true } });
    expect(repair.customerId).toBe(c.json.id);
    expect(repair.customer).toMatchObject({ name: 'Nombre Original', phone: '611' });
    const mine = (await api('/api/portal/repairs', { auth: account.token })).json as { number: string; status: string }[];
    expect(mine.find((r) => r.number === ok.json.number)).toMatchObject({ status: 'SOLICITADA' });
  });

  it('quien se crea la cuenta después, con el mismo email, ve la reparación (vínculo por email)', async () => {
    const email = uniq('despues');
    await request(email);
    const ok = await confirm(tokenIn('PUBLIC_REQUEST_CONFIRM', email)!);
    const account = await userWith('CLIENTE', email);
    await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'x', email: uniq('otro') } }); // ruido
    const { linkCustomerByEmail } = await import('../src/lib/customerLink.js');
    await linkCustomerByEmail(email); // lo que corre al activar la cuenta (RN-09)
    const mine = (await api('/api/portal/repairs', { auth: account.token })).json as { number: string }[];
    expect(mine.map((r) => r.number)).toContain(ok.json.number);
  });

  it('elige del catálogo público; sin datos suficientes responde 400', async () => {
    const cat = await api('/api/public/catalogs');
    expect(cat.status).toBe(200);
    expect(cat.json).toHaveProperty('models');
    expect(JSON.stringify(cat.json)).not.toContain('tools'); // solo nombres, nada de herramientas ni clientes
    expect((await request(uniq('v'), { type: undefined, brand: undefined, model: undefined })).status).toBe(400);
    expect((await request('no-es-un-correo')).status).toBe(400);
    expect((await request(uniq('v'), { declaredFault: '' })).status).toBe(400);
    expect((await request(uniq('v'), { modelId: 99999999, type: undefined, brand: undefined, model: undefined })).status).toBe(400);
  });

  it('anti-abuso: el campo trampa no hace nada y la misma dirección no recibe correos en ráfaga', async () => {
    const bot = uniq('bot');
    expect((await request(bot, { website: 'http://spam' })).status).toBe(202); // misma respuesta que una real
    expect(sent.filter((m) => m.to === bot)).toHaveLength(0);
    expect(await prisma.publicRequest.count({ where: { email: bot } })).toBe(0);

    const victim = uniq('vic');
    for (let i = 0; i < 4; i++) expect((await request(victim)).status).toBe(202);
    expect(sent.filter((m) => m.to === victim && m.type === 'PUBLIC_REQUEST_CONFIRM')).toHaveLength(1); // espera de 60 s entre correos
  });
});

describe('consulta sin cuenta', () => {
  async function confirmed() {
    const email = uniq('cons');
    await request(email);
    const ok = await confirm(tokenIn('PUBLIC_REQUEST_CONFIRM', email)!);
    // El correo de bienvenida ya llevó un enlace: se envejece para probar la consulta fuera de la espera de 60 s.
    await prisma.repairViewToken.updateMany({ where: { repair: { number: ok.json.number } }, data: { createdAt: new Date(Date.now() - 120_000) } });
    sent.length = 0;
    return { email, number: ok.json.number as string };
  }
  const lookup = (receipt: string, email: string) => api('/api/public/lookup', { method: 'POST', body: { receipt, email } });

  it('con resguardo y email correctos llega un enlace temporal; la respuesta es igual aunque no coincida', async () => {
    const c = await confirmed();
    const ok = await lookup(c.number, c.email);
    const wrongEmail = await lookup(c.number, uniq('ajeno'));
    const wrongReceipt = await lookup('REP-0000-000000', c.email);
    expect([ok.status, wrongEmail.status, wrongReceipt.status]).toEqual([202, 202, 202]);
    expect(wrongEmail.json).toEqual(ok.json);
    expect(wrongReceipt.json).toEqual(ok.json);
    expect(sent.filter((m) => m.type === 'REPAIR_STATUS_LINK')).toHaveLength(1);
    expect(sent[0].to).toBe(c.email);
    const token = tokenIn('REPAIR_STATUS_LINK', c.email)!;
    const row = await prisma.repairViewToken.findFirstOrThrow({ where: { tokenHash: hashToken(token) } });
    const hours = (row.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it('también acepta el nº de resguardo del sistema contable, sin distinguir mayúsculas', async () => {
    const c = await confirmed();
    const id = (await prisma.repair.findFirstOrThrow({ where: { number: c.number } })).id;
    await api(`/api/repairs/${id}/accounting-receipt`, { method: 'PUT', auth: rec.token, body: { number: 'Cont-555' } });
    await lookup('cont-555', c.email);
    expect(sent.filter((m) => m.type === 'REPAIR_STATUS_LINK' && m.to === c.email)).toHaveLength(1);
  });

  it('pedidos seguidos para la misma reparación no inundan el correo', async () => {
    const c = await confirmed();
    for (let i = 0; i < 3; i++) await lookup(c.number, c.email);
    expect(sent.filter((m) => m.type === 'REPAIR_STATUS_LINK')).toHaveLength(1);
  });

  it('el enlace muestra el estado, solo lectura y sin importes ni datos personales', async () => {
    const c = await confirmed();
    await lookup(c.number, c.email);
    const token = tokenIn('REPAIR_STATUS_LINK', c.email)!;
    const s = await api(`/api/public/status/${encodeURIComponent(token)}`);
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ number: c.number, status: 'SOLICITADA', quoteWaiting: false, tool: { brand: 'Bosch', model: 'GSB' } });
    expect(s.json.timeline).toHaveLength(1);
    const raw = JSON.stringify(s.json);
    for (const secret of [c.email, '600', 'customerId']) expect(raw).not.toContain(secret);

    // avanza el estado: lo refleja; con presupuesto pendiente solo avisa (decidir exige usuario)
    const id = (await prisma.repair.findFirstOrThrow({ where: { number: c.number } })).id;
    await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: rec.token, body: { to: 'RECIBIDO', reception: { visualState: 'Bien' } } });
    await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
    await api(`/api/repairs/${id}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'LABOR', description: 'x', quantity: 1, unitPrice: 50, taxRate: 21 }] } });
    await api(`/api/repairs/${id}/quote/send`, { method: 'POST', auth: tec.token });
    const after = await api(`/api/public/status/${encodeURIComponent(token)}`);
    expect(after.json).toMatchObject({ status: 'PRESUPUESTO_PENDIENTE_APROBACION', quoteWaiting: true });
    expect(JSON.stringify(after.json)).not.toContain('60.5'); // ningún importe
    // y no hay forma de decidir con este enlace
    expect((await api(`/api/public/status/${encodeURIComponent(token)}/decision`, { method: 'POST', body: { decision: 'APPROVE' } })).status).toBe(404);
  });

  it('un enlace vencido o inventado no muestra nada', async () => {
    const c = await confirmed();
    await lookup(c.number, c.email);
    const token = tokenIn('REPAIR_STATUS_LINK', c.email)!;
    await prisma.repairViewToken.updateMany({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api(`/api/public/status/${encodeURIComponent(token)}`)).status).toBe(410);
    expect((await api(`/api/public/status/${'y'.repeat(43)}`)).status).toBe(404);
  });

  it('el cliente sin usuario no puede aprobar: el portal exige sesión y la decisión por enlace no existe', async () => {
    const c = await confirmed();
    const id = (await prisma.repair.findFirstOrThrow({ where: { number: c.number } })).id;
    expect((await api(`/api/portal/repairs/${id}/quote/decision`, { method: 'POST', body: { decision: 'APPROVE' } })).status).toBe(401);
  });
});
