import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UPLOADS = mkdtempSync(join(tmpdir(), 'servig-portal-'));
process.env.UPLOAD_DIR = UPLOADS;

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

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@por.local';
const uniq = (p = 'p') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 7)]);

async function api(path: string, opts: { method?: string; body?: object; auth?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function userWith(role: string, email = uniq(role.toLowerCase()), status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const u = await prisma.user.create({
    data: { email, firstName: 'Cli', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status, emailVerifiedAt: new Date() },
  });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json?.accessToken as string };
}

type Staff = Awaited<ReturnType<typeof userWith>>;
let rec: Staff, tec: Staff, adm: Staff;

/** Cliente con cuenta del portal ya vinculada, una herramienta y una reparación en revisión. */
async function client(name = 'Ana Portal') {
  const email = uniq('cli');
  const account = await userWith('CLIENTE', email); // la cuenta existe primero: se vincula al crear el cliente (RN-09)
  const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name, email, phone: '600999888', address: 'Calle Privada 5' } });
  const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'Taladro', brand: 'Bosch', model: 'P1' } });
  const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'No enciende', visualState: 'Golpe en carcasa', accessories: 'Maletín' } });
  const repairId = r.json.id as number;
  await api(`/api/repairs/${repairId}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
  return { account, email, customerId: c.json.id as number, repairId };
}

const portal = (path: string, who: { token: string }, opts: { method?: string; body?: object } = {}) => api(`/api/portal${path}`, { auth: who.token, ...opts });
const sendQuote = async (repairId: number) => {
  await api(`/api/repairs/${repairId}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'LABOR', description: 'Mano de obra', quantity: 1, unitPrice: 50, taxRate: 21 }] } });
  return api(`/api/repairs/${repairId}/quote/send`, { method: 'POST', auth: tec.token });
};
const decide = (repairId: number, who: { token: string }, decision: string, comment?: string) =>
  portal(`/repairs/${repairId}/quote/decision`, who, { method: 'POST', body: { decision, comment } });
const upload = (repairId: number, data: Buffer, name = 'foto.jpg') =>
  fetch(`${base}/api/repairs/${repairId}/attachments`, {
    method: 'POST', headers: { authorization: `Bearer ${tec.token}`, 'x-filename': encodeURIComponent(name) }, body: data,
  }).then((r) => r.json() as Promise<{ id: number }>);
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
  rmSync(UPLOADS, { recursive: true, force: true });
});

describe('acceso al portal', () => {
  it('anónimo 401; el personal 403; una cuenta sin cliente vinculado recibe un mensaje claro', async () => {
    expect((await api('/api/portal/repairs')).status).toBe(401);
    for (const who of [rec, tec, adm]) expect((await portal('/repairs', who)).status).toBe(403);
    const lonely = await userWith('CLIENTE');
    const res = await portal('/repairs', lonely);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('NO_CUSTOMER_LINK');
  });

  it('un cliente deshabilitado pierde el acceso al instante', async () => {
    const c = await client();
    expect((await portal('/repairs', c.account)).status).toBe(200);
    await prisma.user.update({ where: { id: c.account.id }, data: { status: 'DISABLED' } });
    expect((await portal('/repairs', c.account)).status).toBe(401);
  });

  it('un CLIENTE no accede a las rutas del personal', async () => {
    const c = await client();
    for (const path of ['/api/repairs', `/api/repairs/${c.repairId}`, `/api/repairs/${c.repairId}/quote`, '/api/customers', '/api/users']) {
      expect((await api(path, { auth: c.account.token })).status, path).toBe(403);
    }
    expect((await api(`/api/repairs/${c.repairId}/transition`, { method: 'POST', auth: c.account.token, body: { to: 'CANCELADO', comment: 'x' } })).status).toBe(403);
  });
});

describe('aislamiento entre clientes', () => {
  it('cada cliente ve solo lo suyo; lo ajeno responde 404 como si no existiera', async () => {
    const a = await client('Cliente A');
    const b = await client('Cliente B');
    await sendQuote(b.repairId);
    const attB = await upload(b.repairId, JPG);
    await api(`/api/repairs/${b.repairId}/attachments/${attB.id}`, { method: 'PATCH', auth: tec.token, body: { visibleToCustomer: true } });

    const listA = await portal('/repairs', a.account);
    expect(listA.json.map((r: { id: number }) => r.id)).toEqual([a.repairId]);
    expect((await portal('/repairs', b.account)).json.map((r: { id: number }) => r.id)).toEqual([b.repairId]);

    expect((await portal(`/repairs/${b.repairId}`, a.account)).status).toBe(404);
    expect((await fetch(`${base}/api/portal/repairs/${b.repairId}/attachments/${attB.id}`, { headers: { authorization: `Bearer ${a.account.token}` } })).status).toBe(404);
    const steal = await decide(b.repairId, a.account, 'APPROVE');
    expect(steal.status).toBe(404);
    expect(await statusOf(b.repairId)).toBe('PRESUPUESTO_PENDIENTE_APROBACION'); // intacta
    expect((await portal('/repairs/999999999', a.account)).status).toBe(404);
  });
});

describe('lo que el cliente ve', () => {
  it('lista con estado, indicador de activa y de presupuesto pendiente', async () => {
    const c = await client();
    let l = (await portal('/repairs', c.account)).json[0];
    expect(l).toMatchObject({ id: c.repairId, status: 'EN_REVISION', active: true, pendingQuote: false, tool: { brand: 'Bosch' } });
    await sendQuote(c.repairId);
    l = (await portal('/repairs', c.account)).json[0];
    expect(l).toMatchObject({ status: 'PRESUPUESTO_PENDIENTE_APROBACION', pendingQuote: true });
    await api(`/api/repairs/${c.repairId}/transition`, { method: 'POST', auth: adm.token, body: { to: 'CANCELADO', comment: 'x' } });
    expect((await portal('/repairs', c.account)).json[0]).toMatchObject({ status: 'CANCELADO', active: false, pendingQuote: false });
  });

  it('no filtra nada interno: diagnósticos privados, comentarios, personal, costes ni datos de otros', async () => {
    const c = await client();
    await api(`/api/repairs/${c.repairId}/diagnosis`, { method: 'POST', auth: tec.token, body: { text: 'Inducido quemado', visibleToCustomer: true } });
    await api(`/api/repairs/${c.repairId}/diagnosis`, { method: 'POST', auth: tec.token, body: { text: 'SECRETO: el cliente es difícil', visibleToCustomer: false } });
    await sendQuote(c.repairId);
    await api(`/api/repairs/${c.repairId}/quote/withdraw`, { method: 'POST', auth: tec.token, body: { comment: 'COMENTARIO-INTERNO-ERROR' } });

    const r = await portal(`/repairs/${c.repairId}`, c.account);
    expect(r.status).toBe(200);
    expect(r.json.diagnoses.map((d: { text: string }) => d.text)).toEqual(['Inducido quemado']);
    const raw = JSON.stringify(r.json);
    for (const secret of ['SECRETO', 'COMENTARIO-INTERNO', tec.email, rec.email, 'TECNICO', 'RECEPCION', 'receivedBy', 'userId']) {
      expect(raw, secret).not.toContain(secret);
    }
    // timeline solo con estado y fecha
    expect(r.json.timeline.every((t: object) => Object.keys(t).sort().join() === 'at,status')).toBe(true);
  });

  it('el presupuesto solo aparece cuando se envió; un borrador o una versión retirada no existen para el cliente', async () => {
    const c = await client();
    expect((await portal(`/repairs/${c.repairId}`, c.account)).json.quote).toBeNull();
    await api(`/api/repairs/${c.repairId}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'LABOR', description: 'Borrador', quantity: 1, unitPrice: 10, taxRate: 21 }] } });
    expect((await portal(`/repairs/${c.repairId}`, c.account)).json.quote).toBeNull();

    await api(`/api/repairs/${c.repairId}/quote/send`, { method: 'POST', auth: tec.token });
    const q = (await portal(`/repairs/${c.repairId}`, c.account)).json.quote;
    expect(q).toMatchObject({ version: 1, status: 'ENVIADO', canDecide: true, total: '12.10', subtotal: '10.00', taxTotal: '2.10' });
    expect(q.items[0]).toMatchObject({ description: 'Borrador', lineNet: '10.00' });

    await api(`/api/repairs/${c.repairId}/quote/withdraw`, { method: 'POST', auth: tec.token, body: { comment: 'corregir' } });
    expect((await portal(`/repairs/${c.repairId}`, c.account)).json.quote).toBeNull();
  });

  it('un presupuesto vencido se ve pero no se puede decidir', async () => {
    const c = await client();
    await sendQuote(c.repairId);
    await prisma.quoteVersion.updateMany({ where: { quote: { repairId: c.repairId } }, data: { validUntil: new Date(Date.now() - 1000) } });
    const q = (await portal(`/repairs/${c.repairId}`, c.account)).json.quote;
    expect(q).toMatchObject({ status: 'VENCIDO', canDecide: false });
    const res = await decide(c.repairId, c.account, 'APPROVE');
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('QUOTE_EXPIRED');
  });

  it('repuestos: solo desde la aprobación, sin cancelados y sin costes ni precios', async () => {
    const c = await client();
    await api(`/api/repairs/${c.repairId}/spare-parts`, { method: 'POST', auth: tec.token, body: { description: 'Escobillas', quantity: 2, cost: 4.57, price: 9.91, supplier: 'ProveedorSecreto' } });
    const cancelled = await api(`/api/repairs/${c.repairId}/spare-parts`, { method: 'POST', auth: tec.token, body: { description: 'Cancelado', quantity: 1, cost: 1, price: 2 } });
    await api(`/api/spare-parts/${cancelled.json.id}/status`, { method: 'POST', auth: tec.token, body: { to: 'CANCELADO' } });

    expect((await portal(`/repairs/${c.repairId}`, c.account)).json.spareParts).toEqual([]); // aún en revisión
    await prisma.repair.update({ where: { id: c.repairId }, data: { status: 'EN_REPARACION' } });
    const r = await portal(`/repairs/${c.repairId}`, c.account);
    expect(r.json.spareParts).toEqual([{ description: 'Escobillas', quantity: 2, status: 'NECESARIO' }]);
    const raw = JSON.stringify(r.json);
    for (const s of ['4.57', '9.91', 'ProveedorSecreto', 'Cancelado']) expect(raw).not.toContain(s);
  });

  it('el resguardo no incluye quién recibió la herramienta', async () => {
    const c = await client();
    const r = (await portal(`/repairs/${c.repairId}`, c.account)).json;
    expect(r.receipt).toMatchObject({ visualState: 'Golpe en carcasa', accessories: 'Maletín', customer: { name: 'Ana Portal' } });
    expect(r.receipt.business.name).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain('receivedBy');
  });
});

describe('documentos', () => {
  it('son privados por defecto; el taller decide cuáles ve el cliente', async () => {
    const c = await client();
    const att = await upload(c.repairId, JPG, 'frente.jpg');
    expect((await portal(`/repairs/${c.repairId}`, c.account)).json.attachments).toEqual([]);
    const hidden = await fetch(`${base}/api/portal/repairs/${c.repairId}/attachments/${att.id}`, { headers: { authorization: `Bearer ${c.account.token}` } });
    expect(hidden.status).toBe(404);

    // el cliente no puede publicar sus propios adjuntos; el personal sí
    expect((await api(`/api/repairs/${c.repairId}/attachments/${att.id}`, { method: 'PATCH', auth: c.account.token, body: { visibleToCustomer: true } })).status).toBe(403);
    const on = await api(`/api/repairs/${c.repairId}/attachments/${att.id}`, { method: 'PATCH', auth: rec.token, body: { visibleToCustomer: true } });
    expect(on.json.visibleToCustomer).toBe(true);

    const list = (await portal(`/repairs/${c.repairId}`, c.account)).json.attachments;
    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe('frente.jpg');
    const dl = await fetch(`${base}/api/portal/repairs/${c.repairId}/attachments/${att.id}`, { headers: { authorization: `Bearer ${c.account.token}` } });
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).equals(JPG)).toBe(true);

    await api(`/api/repairs/${c.repairId}/attachments/${att.id}`, { method: 'PATCH', auth: rec.token, body: { visibleToCustomer: false } });
    expect((await portal(`/repairs/${c.repairId}`, c.account)).json.attachments).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: 'ATTACHMENT_VISIBILITY', entityId: String(c.repairId) } })).toBe(2);
  });
});

describe('decisión desde el portal', () => {
  it('aprobar: queda registrado con origen PORTAL y el usuario, y habilita la reparación', async () => {
    const c = await client();
    await sendQuote(c.repairId);
    expect((await api(`/api/repairs/${c.repairId}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REPARACION' } })).status).toBe(409);

    sent.length = 0;
    const res = await decide(c.repairId, c.account, 'APPROVE');
    expect(res.status).toBe(200);
    expect(await statusOf(c.repairId)).toBe('PRESUPUESTO_APROBADO');

    const ap = await prisma.quoteApproval.findFirstOrThrow({ where: { version: { quote: { repairId: c.repairId } } } });
    expect(ap).toMatchObject({ decision: 'APROBADO', origin: 'CUSTOMER_PORTAL', userId: c.account.id });
    expect(ap.ip).toBeTruthy();
    const h = await prisma.repairStatusHistory.findFirstOrThrow({ where: { repairId: c.repairId, toStatus: 'PRESUPUESTO_APROBADO' } });
    expect(h).toMatchObject({ origin: 'CUSTOMER_PORTAL', userId: c.account.id });
    expect(sent.map((m) => m.type).sort()).toEqual(['QUOTE_APPROVED', 'STAFF_QUOTE_DECISION']);

    expect((await api(`/api/repairs/${c.repairId}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REPARACION' } })).status).toBe(200);
    const after = (await portal(`/repairs/${c.repairId}`, c.account)).json.quote;
    expect(after).toMatchObject({ status: 'APROBADO', canDecide: false });
    expect(after.decision.decision).toBe('APROBADO');
  });

  it('rechazar con motivo', async () => {
    const c = await client();
    await sendQuote(c.repairId);
    expect((await decide(c.repairId, c.account, 'REJECT', 'Muy caro')).status).toBe(200);
    expect(await statusOf(c.repairId)).toBe('PRESUPUESTO_RECHAZADO');
    const ap = await prisma.quoteApproval.findFirstOrThrow({ where: { version: { quote: { repairId: c.repairId } } } });
    expect(ap).toMatchObject({ decision: 'RECHAZADO', comment: 'Muy caro', origin: 'CUSTOMER_PORTAL' });
  });

  it('solo se decide una vez, y el enlace del correo queda inutilizado', async () => {
    const c = await client();
    await sendQuote(c.repairId);
    const mail = sent.find((m) => m.to === c.email && m.type === 'QUOTE_AVAILABLE')!;
    const token = decodeURIComponent(mail.html.match(/quote-approval\?token=([^"]+)"/)![1]);

    expect((await decide(c.repairId, c.account, 'APPROVE')).status).toBe(200);
    for (const d of ['APPROVE', 'REJECT']) {
      const again = await decide(c.repairId, c.account, d);
      expect(again.status).toBe(409);
      expect(again.json.code).toBe('ALREADY_DECIDED');
    }
    const viaLink = await api(`/api/public/quote-approval/${encodeURIComponent(token)}/decision`, { method: 'POST', body: { decision: 'REJECT' } });
    expect(viaLink.status).toBe(409);
    expect((await api(`/api/public/quote-approval/${encodeURIComponent(token)}`)).json.state).toBe('DECIDED');
    expect(await prisma.quoteApproval.count({ where: { version: { quote: { repairId: c.repairId } } } })).toBe(1);
  });

  it('portal y enlace a la vez: gana una sola decisión', async () => {
    const c = await client();
    await sendQuote(c.repairId);
    const token = decodeURIComponent(sent.find((m) => m.to === c.email && m.type === 'QUOTE_AVAILABLE')!.html.match(/quote-approval\?token=([^"]+)"/)![1]);
    const [a, b] = await Promise.all([
      decide(c.repairId, c.account, 'APPROVE'),
      api(`/api/public/quote-approval/${encodeURIComponent(token)}/decision`, { method: 'POST', body: { decision: 'REJECT' } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.quoteApproval.count({ where: { version: { quote: { repairId: c.repairId } } } })).toBe(1);
  });

  it('sin presupuesto enviado no hay nada que decidir; valida el cuerpo', async () => {
    const c = await client();
    expect((await decide(c.repairId, c.account, 'APPROVE')).status).toBe(404); // ni siquiera hay presupuesto
    await api(`/api/repairs/${c.repairId}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'LABOR', description: 'x', quantity: 1, unitPrice: 5, taxRate: 21 }] } });
    expect((await decide(c.repairId, c.account, 'APPROVE')).status).toBe(404); // un borrador no existe para el cliente
    expect((await decide(c.repairId, c.account, 'TAL_VEZ')).status).toBe(400);
    expect(await statusOf(c.repairId)).toBe('EN_REVISION');
  });

  it('tras un retiro y reenvío, decide sobre la versión vigente', async () => {
    const c = await client();
    await sendQuote(c.repairId);
    await api(`/api/repairs/${c.repairId}/quote/withdraw`, { method: 'POST', auth: tec.token, body: { comment: 'precio' } });
    expect((await decide(c.repairId, c.account, 'APPROVE')).status).toBe(409); // retirada: nada pendiente
    await api(`/api/repairs/${c.repairId}/quote/new-version`, { method: 'POST', auth: tec.token });
    await api(`/api/repairs/${c.repairId}/quote/send`, { method: 'POST', auth: tec.token });
    expect((await portal(`/repairs/${c.repairId}`, c.account)).json.quote.version).toBe(2);
    expect((await decide(c.repairId, c.account, 'APPROVE')).status).toBe(200);
    const ap = await prisma.quoteApproval.findFirstOrThrow({ where: { version: { quote: { repairId: c.repairId } } }, include: { version: true } });
    expect(ap.version.version).toBe(2);
  });
});
