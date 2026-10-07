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
const { seedRolesAndPermissions } = await import('../src/lib/seedRoles.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const uniq = (p = 'u') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@users.local`;
const tokenOf = (to: string, type: string) =>
  decodeURIComponent(sent.find((m) => m.to === to && m.type === type)!.html.match(/token=([^"]+)"/)![1]);

async function api(path: string, opts: { method?: string; body?: object; auth?: string; cookie?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

async function userWith(role: string) {
  const email = uniq(role.toLowerCase());
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email, firstName: 'T', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: user.id, email, token: login.json.accessToken as string, cookie: login.cookie };
}

beforeAll(async () => {
  await seedRolesAndPermissions(prisma);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@users.local' } }, select: { id: true } });
  const where = { userId: { in: users.map((u) => u.id) } };
  await prisma.emailVerificationToken.deleteMany({ where });
  await prisma.passwordResetToken.deleteMany({ where });
  await prisma.refreshToken.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { OR: [where, { entityId: { in: users.map((u) => String(u.id)) } }] } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@users.local' } } });
  server.close();
  await prisma.$disconnect();
});

describe('autorización de /api/users', () => {
  it('sin token → 401; sin permiso → 403 (CLIENTE, RECEPCION y TECNICO)', async () => {
    expect((await api('/api/users')).status).toBe(401);
    for (const role of ['CLIENTE', 'RECEPCION', 'TECNICO']) {
      const u = await userWith(role);
      expect((await api('/api/users', { auth: u.token })).status).toBe(403);
      expect((await api('/api/users', { method: 'POST', auth: u.token, body: { firstName: 'A', lastName: 'B', email: uniq(), role: 'ADMIN' } })).status).toBe(403);
    }
  });

  it('/me expone los permisos del rol', async () => {
    const admin = await userWith('ADMIN');
    const me = await api('/api/auth/me', { auth: admin.token });
    expect(me.json.permissions).toEqual(expect.arrayContaining(['user:read', 'user:create', 'user:update']));
    const cli = await userWith('CLIENTE');
    expect((await api('/api/auth/me', { auth: cli.token })).json.permissions).toEqual([]);
  });
});

describe('gestión de usuarios por ADMIN', () => {
  it('invita a un TECNICO: define su contraseña con el enlace y queda activo con ese rol', async () => {
    const admin = await userWith('ADMIN');
    const email = uniq('tec');
    const created = await api('/api/users', { method: 'POST', auth: admin.token, body: { firstName: 'Tec', lastName: 'Nico', email: email.toUpperCase(), role: 'TECNICO' } });
    expect(created.status).toBe(201);
    expect(created.json.status).toBe('PENDING_EMAIL_VERIFICATION');
    expect(sent.filter((m) => m.to === email && m.type === 'AUTH_INVITE')).toHaveLength(1);

    // aún sin contraseña definida no puede entrar
    expect((await api('/api/auth/login', { method: 'POST', body: { email, password: PW } })).status).toBe(401);

    const NEW = 'ClaveTecnico123';
    const reset = await api('/api/auth/reset-password', { method: 'POST', body: { token: tokenOf(email, 'AUTH_INVITE'), password: NEW, confirmPassword: NEW } });
    expect(reset.status).toBe(200);
    const login = await api('/api/auth/login', { method: 'POST', body: { email, password: NEW } });
    expect(login.status).toBe(200);
    expect(login.json.user.role).toBe('TECNICO');
    expect(login.json.user.permissions).toEqual([]);
  });

  it('rechaza email duplicado (409) y rol inválido (400)', async () => {
    const admin = await userWith('ADMIN');
    const dup = await api('/api/users', { method: 'POST', auth: admin.token, body: { firstName: 'A', lastName: 'B', email: admin.email, role: 'TECNICO' } });
    expect(dup.status).toBe(409);
    const bad = await api('/api/users', { method: 'POST', auth: admin.token, body: { firstName: 'A', lastName: 'B', email: uniq(), role: 'SUPERUSER' } });
    expect(bad.status).toBe(400);
  });

  it('cambia el rol: surte efecto de inmediato con el mismo token', async () => {
    const admin = await userWith('ADMIN');
    const target = await userWith('RECEPCION');
    expect((await api('/api/users', { auth: target.token })).status).toBe(403);
    const up = await api(`/api/users/${target.id}`, { method: 'PATCH', auth: admin.token, body: { role: 'ADMIN' } });
    expect(up.status).toBe(200);
    expect(up.json.role).toBe('ADMIN');
    expect((await api('/api/users', { auth: target.token })).status).toBe(200);
  });

  it('deshabilitar revoca sesiones, bloquea el login y los tokens vigentes', async () => {
    const admin = await userWith('ADMIN');
    const target = await userWith('ADMIN');
    expect((await api('/api/users', { auth: target.token })).status).toBe(200);

    const off = await api(`/api/users/${target.id}`, { method: 'PATCH', auth: admin.token, body: { status: 'DISABLED' } });
    expect(off.json.status).toBe('DISABLED');
    expect((await api('/api/users', { auth: target.token })).status).toBe(401); // access token aún no vencido
    expect((await api('/api/auth/refresh', { method: 'POST', cookie: target.cookie })).status).toBe(401);
    expect((await api('/api/auth/login', { method: 'POST', body: { email: target.email, password: PW } })).status).toBe(401);

    const on = await api(`/api/users/${target.id}`, { method: 'PATCH', auth: admin.token, body: { status: 'ACTIVE' } });
    expect(on.json.status).toBe('ACTIVE');
    expect((await api('/api/auth/login', { method: 'POST', body: { email: target.email, password: PW } })).status).toBe(200);
  });

  it('un ADMIN no puede cambiar su propio rol ni estado', async () => {
    const admin = await userWith('ADMIN');
    expect((await api(`/api/users/${admin.id}`, { method: 'PATCH', auth: admin.token, body: { role: 'CLIENTE' } })).status).toBe(409);
    expect((await api(`/api/users/${admin.id}`, { method: 'PATCH', auth: admin.token, body: { status: 'DISABLED' } })).status).toBe(409);
  });

  it('no se puede activar a mano una cuenta sin email confirmado', async () => {
    const admin = await userWith('ADMIN');
    const created = await api('/api/users', { method: 'POST', auth: admin.token, body: { firstName: 'P', lastName: 'Q', email: uniq(), role: 'TECNICO' } });
    expect((await api(`/api/users/${created.json.id}`, { method: 'PATCH', auth: admin.token, body: { status: 'ACTIVE' } })).status).toBe(409);
  });

  it('reenvía la invitación solo a cuentas pendientes', async () => {
    const admin = await userWith('ADMIN');
    const email = uniq('inv');
    const created = await api('/api/users', { method: 'POST', auth: admin.token, body: { firstName: 'P', lastName: 'Q', email, role: 'RECEPCION' } });
    sent.length = 0;
    expect((await api(`/api/users/${created.json.id}/resend-invite`, { method: 'POST', auth: admin.token })).status).toBe(202);
    expect(sent.filter((m) => m.type === 'AUTH_INVITE')).toHaveLength(1);
    const active = await userWith('TECNICO');
    expect((await api(`/api/users/${active.id}/resend-invite`, { method: 'POST', auth: admin.token })).status).toBe(409);
  });

  it('lista y filtra por búsqueda, rol y estado', async () => {
    const admin = await userWith('ADMIN');
    const t = await userWith('TECNICO');
    const byRole = await api('/api/users?role=TECNICO', { auth: admin.token });
    expect(byRole.json.every((u: { role: string }) => u.role === 'TECNICO')).toBe(true);
    const byText = await api(`/api/users?search=${encodeURIComponent(t.email.slice(0, 25))}`, { auth: admin.token });
    expect(byText.json.map((u: { id: number }) => u.id)).toContain(t.id);
    const pending = await api('/api/users?status=PENDING_EMAIL_VERIFICATION', { auth: admin.token });
    expect(pending.json.every((u: { status: string }) => u.status === 'PENDING_EMAIL_VERIFICATION')).toBe(true);
  });

  it('registra la auditoría de creación y cambios', async () => {
    const admin = await userWith('ADMIN');
    const target = await userWith('TECNICO');
    await api(`/api/users/${target.id}`, { method: 'PATCH', auth: admin.token, body: { role: 'RECEPCION' } });
    const log = await prisma.auditLog.findFirst({ where: { action: 'USER_UPDATED', entityId: String(target.id), userId: admin.id } });
    expect(log?.data).toMatchObject({ from: { role: 'TECNICO' }, to: { role: 'RECEPCION' } });
  });
});
