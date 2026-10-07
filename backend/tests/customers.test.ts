import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const sent: { to: string; type: string; html: string }[] = [];
vi.mock('../src/lib/email.js', () => ({
  sendEmail: vi.fn(async (m) => {
    sent.push(m);
    return true;
  }),
}));

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/security.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@cust.local';
const uniq = (p = 'c') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;
const nif = () => `X${Math.random().toString(36).slice(2, 9).toUpperCase()}`;

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
  await prisma.user.create({
    data: { email, firstName: 'T', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { email, token: login.json.accessToken as string };
}

const newCustomer = (token: string, over: object = {}) =>
  api('/api/customers', { method: 'POST', auth: token, body: { name: 'Taller Pérez S.L.', email: uniq('cust'), ...over } });

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const customers = await prisma.customer.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const where = { userId: { in: users.map((u) => u.id) } };
  await prisma.emailVerificationToken.deleteMany({ where });
  await prisma.passwordResetToken.deleteMany({ where });
  await prisma.refreshToken.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.tool.deleteMany({ where: { customerId: { in: customers.map((c) => c.id) } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } });
  server.close();
  await prisma.$disconnect();
});

describe('permisos', () => {
  it('sin token 401; CLIENTE 403; TECNICO solo lectura; RECEPCION y ADMIN escriben', async () => {
    expect((await api('/api/customers')).status).toBe(401);
    const cli = await userWith('CLIENTE');
    expect((await api('/api/customers', { auth: cli.token })).status).toBe(403);
    expect((await api('/api/tools', { auth: cli.token })).status).toBe(403);

    const tec = await userWith('TECNICO');
    expect((await api('/api/customers', { auth: tec.token })).status).toBe(200);
    expect((await newCustomer(tec.token)).status).toBe(403);

    for (const role of ['RECEPCION', 'ADMIN']) {
      const u = await userWith(role);
      expect((await newCustomer(u.token)).status).toBe(201);
    }
  });
});

describe('clientes', () => {
  it('crea, normaliza el NIF, edita y vacía campos', async () => {
    const rec = await userWith('RECEPCION');
    const tax = nif();
    const created = await newCustomer(rec.token, { taxId: ` ${tax.slice(0, 3).toLowerCase()}-${tax.slice(3, 6)}.${tax.slice(6)} `, phone: '600 111 222' });
    expect(created.status).toBe(201);
    expect(created.json.taxId).toBe(tax);

    const id = created.json.id;
    const upd = await api(`/api/customers/${id}`, { method: 'PATCH', auth: rec.token, body: { phone: '', address: 'Calle 1' } });
    expect(upd.json.phone).toBeNull();
    expect(upd.json.address).toBe('Calle 1');
    expect(upd.json.name).toBe('Taller Pérez S.L.'); // lo no enviado no cambia
  });

  it('rechaza NIF y email duplicados (409) y datos inválidos (400)', async () => {
    const rec = await userWith('RECEPCION');
    const tax = nif();
    const email = uniq('dup');
    expect((await newCustomer(rec.token, { taxId: tax, email })).status).toBe(201);
    const dupTax = await newCustomer(rec.token, { taxId: tax.toLowerCase() });
    expect(dupTax.status).toBe(409);
    expect(dupTax.json.code).toBe('DUPLICATE_TAXID');
    const dupMail = await newCustomer(rec.token, { email: email.toUpperCase() });
    expect(dupMail.status).toBe(409);
    expect(dupMail.json.code).toBe('DUPLICATE_EMAIL');

    expect((await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: '' } })).status).toBe(400);
    expect((await newCustomer(rec.token, { email: 'no-es-email' })).status).toBe(400);
  });

  it('varios clientes sin email ni NIF no chocan entre sí', async () => {
    const rec = await userWith('RECEPCION');
    const mk = () => api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Mostrador', email: '', taxId: '' } });
    // los '' se guardan como null: la unicidad no aplica
    const [a, b] = [await mk(), await mk()];
    expect([a.status, b.status]).toEqual([201, 201]);
    await prisma.customer.deleteMany({ where: { id: { in: [a.json.id, b.json.id] } } });
  });

  it('busca por nombre, NIF, email o teléfono y devuelve la ficha con herramientas', async () => {
    const rec = await userWith('RECEPCION');
    const tax = nif();
    const c = await newCustomer(rec.token, { name: 'Ferretería Zulú', taxId: tax });
    await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'Taladro', brand: 'Bosch', model: 'GSB 18V' } });

    const found = await api(`/api/customers?search=${tax}`, { auth: rec.token });
    expect(found.json.map((x: { id: number }) => x.id)).toContain(c.json.id);
    expect(found.json[0].toolCount).toBe(1);

    const detail = await api(`/api/customers/${c.json.id}`, { auth: rec.token });
    expect(detail.json.tools).toHaveLength(1);
    expect(detail.json.portalUser).toBeNull();
    expect((await api('/api/customers/999999999', { auth: rec.token })).status).toBe(404);
  });
});

describe('herramientas', () => {
  it('crea con fechas y calcula si la garantía sigue vigente', async () => {
    const rec = await userWith('RECEPCION');
    const c = await newCustomer(rec.token);
    const mk = (warrantyExpiresAt: string) =>
      api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'Amoladora', brand: 'Makita', model: '9557', serialNumber: 'SN1', purchaseDate: '2025-01-10', warrantyExpiresAt } });

    const vigente = await mk('2999-01-01');
    expect(vigente.status).toBe(201);
    expect(vigente.json.purchaseDate).toBe('2025-01-10');
    expect(vigente.json.warrantyActive).toBe(true);
    expect((await mk('2020-01-01')).json.warrantyActive).toBe(false);
  });

  it('valida campos obligatorios, fechas y cliente inexistente', async () => {
    const rec = await userWith('RECEPCION');
    const c = await newCustomer(rec.token);
    const post = (body: object) => api('/api/tools', { method: 'POST', auth: rec.token, body });
    expect((await post({ customerId: c.json.id, type: 'X', brand: 'Y' })).status).toBe(400); // falta modelo
    expect((await post({ customerId: c.json.id, type: 'X', brand: 'Y', model: 'Z', purchaseDate: '10/01/2025' })).status).toBe(400);
    expect((await post({ customerId: 999999999, type: 'X', brand: 'Y', model: 'Z' })).status).toBe(404);
  });

  it('edita (sin cambiar de dueño) y filtra por cliente o texto', async () => {
    const rec = await userWith('RECEPCION');
    const c1 = await newCustomer(rec.token);
    const c2 = await newCustomer(rec.token);
    const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c1.json.id, type: 'Sierra', brand: 'Dewalt', model: 'DWE', serialNumber: 'ZZ-9' } });

    const upd = await api(`/api/tools/${t.json.id}`, { method: 'PATCH', auth: rec.token, body: { model: 'DWE2', serialNumber: '', customerId: c2.json.id } });
    expect(upd.json.model).toBe('DWE2');
    expect(upd.json.serialNumber).toBeNull();
    expect(upd.json.customerId).toBe(c1.json.id);

    const byCustomer = await api(`/api/tools?customerId=${c1.json.id}`, { auth: rec.token });
    expect(byCustomer.json).toHaveLength(1);
    expect((await api(`/api/tools?customerId=${c2.json.id}`, { auth: rec.token })).json).toHaveLength(0);
    expect((await api('/api/tools?search=dewalt', { auth: rec.token })).json.some((x: { id: number }) => x.id === t.json.id)).toBe(true);
    expect((await api('/api/tools/999999999', { auth: rec.token })).status).toBe(404);
  });
});

describe('vinculación cuenta CLIENTE ↔ cliente por email (RN-09)', () => {
  it('cuenta primero, cliente después: se vincula al crear el cliente', async () => {
    const rec = await userWith('RECEPCION');
    const cli = await userWith('CLIENTE');
    expect((await api('/api/auth/me', { auth: cli.token })).json.customerId).toBeNull();
    const c = await newCustomer(rec.token, { email: cli.email });
    expect((await api('/api/auth/me', { auth: cli.token })).json.customerId).toBe(c.json.id);
    const detail = await api(`/api/customers/${c.json.id}`, { auth: rec.token });
    expect(detail.json.portalUser.email).toBe(cli.email);
  });

  it('cliente primero, cuenta después: se vincula al confirmar el email', async () => {
    const rec = await userWith('RECEPCION');
    const email = uniq('reg');
    const c = await newCustomer(rec.token, { email });
    await api('/api/auth/register', { method: 'POST', body: { firstName: 'R', lastName: 'G', email, password: PW, confirmPassword: PW } });
    const token = decodeURIComponent(sent.find((m) => m.to === email)!.html.match(/token=([^"]+)"/)![1]);
    await api('/api/auth/verify-email', { method: 'POST', body: { token } });
    const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
    expect(login.json.user.customerId).toBe(c.json.id);
  });

  it('también al agregar el email a un cliente existente', async () => {
    const rec = await userWith('RECEPCION');
    const cli = await userWith('CLIENTE');
    const c = await newCustomer(rec.token, { email: '' });
    await api(`/api/customers/${c.json.id}`, { method: 'PATCH', auth: rec.token, body: { email: cli.email } });
    expect((await api('/api/auth/me', { auth: cli.token })).json.customerId).toBe(c.json.id);
  });

  it('un usuario de personal con el mismo email no se vincula', async () => {
    const rec = await userWith('RECEPCION');
    const tec = await userWith('TECNICO');
    await newCustomer(rec.token, { email: tec.email });
    expect((await api('/api/auth/me', { auth: tec.token })).json.customerId).toBeNull();
  });
});
