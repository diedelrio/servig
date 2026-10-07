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
const { passwordSchema } = await import('../src/modules/auth/schemas.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const mails = (to: string, type: string) => sent.filter((m) => m.to === to && m.type === type);
const tokenOf = (m?: { html: string }) => decodeURIComponent(m!.html.match(/token=([^"]+)"/)![1]);
const uniq = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@t.local`;

async function api(path: string, body?: object, cookie?: string, method = 'POST') {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie')?.split(';')[0];
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json, cookie: setCookie };
}

const register = (email: string, over = {}) =>
  api('/api/auth/register', { firstName: 'Ana', lastName: 'Pérez', email, password: PW, confirmPassword: PW, ...over });

async function activeUser() {
  const email = uniq();
  await register(email);
  await api('/api/auth/verify-email', { token: tokenOf(mails(email, 'AUTH_VERIFY_EMAIL')[0]), password: PW });
  return email;
}

beforeAll(async () => {
  await prisma.role.upsert({ where: { name: 'CLIENTE' }, update: {}, create: { name: 'CLIENTE' } });
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@t.local' } }, select: { id: true } });
  const where = { userId: { in: users.map((u) => u.id) } };
  await prisma.emailVerificationToken.deleteMany({ where });
  await prisma.passwordResetToken.deleteMany({ where });
  await prisma.refreshToken.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@t.local' } } });
  server.close();
  await prisma.$disconnect();
});

describe('política de contraseña', () => {
  it.each([['corta1', false], ['sololetrasaqui', false], ['12345678901', false], ['password123', false], ['ClaveSegura123', true]])(
    '%s → %s',
    (p, ok) => expect(passwordSchema.safeParse(p).success).toBe(ok),
  );
});

describe('registro y confirmación de email', () => {
  it('crea usuario pendiente, envía email y no permite login hasta confirmar', async () => {
    const email = uniq();
    expect((await register(email)).status).toBe(202);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.status).toBe('PENDING_EMAIL_VERIFICATION');
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(mails(email, 'AUTH_VERIFY_EMAIL')).toHaveLength(1);

    const login = await api('/api/auth/login', { email, password: PW });
    expect(login.status).toBe(403);
    expect(login.json.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('el token activa la cuenta una sola vez', async () => {
    const email = uniq();
    await register(email);
    const token = tokenOf(mails(email, 'AUTH_VERIFY_EMAIL')[0]);
    expect((await api('/api/auth/verify-email', { token, password: PW })).status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.status).toBe('ACTIVE');
    expect(u.emailVerifiedAt).not.toBeNull();
    expect((await api('/api/auth/verify-email', { token, password: PW })).status).toBe(400);
  });

  it('rechaza token vencido o inventado', async () => {
    const email = uniq();
    await register(email);
    const token = tokenOf(mails(email, 'AUTH_VERIFY_EMAIL')[0]);
    await prisma.emailVerificationToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) }, where: { user: { email } } });
    expect((await api('/api/auth/verify-email', { token, password: PW })).status).toBe(400);
    expect((await api('/api/auth/verify-email', { token: 'inventado', password: PW })).status).toBe(400);
  });

  it('email duplicado: misma respuesta y sin segundo correo', async () => {
    const email = uniq();
    await register(email);
    sent.length = 0;
    const r = await register(email);
    expect(r.status).toBe(202);
    expect(sent).toHaveLength(0);
  });

  it('valida contraseñas distintas y débiles', async () => {
    expect((await register(uniq(), { confirmPassword: 'otra' })).status).toBe(400);
    expect((await register(uniq(), { password: 'corta1', confirmPassword: 'corta1' })).status).toBe(400);
  });

  it('el reenvío respeta el cooldown de 60 s', async () => {
    const email = uniq();
    await register(email);
    sent.length = 0;
    await api('/api/auth/resend-verification', { email });
    expect(sent).toHaveLength(0); // acaba de enviarse uno
    await prisma.emailVerificationToken.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) }, where: { user: { email } } });
    await api('/api/auth/resend-verification', { email });
    expect(mails(email, 'AUTH_VERIFY_EMAIL')).toHaveLength(1);
  });
});

describe('login y sesión', () => {
  it('mensaje idéntico para usuario inexistente y contraseña incorrecta', async () => {
    const email = await activeUser();
    const a = await api('/api/auth/login', { email, password: 'incorrecta123' });
    const b = await api('/api/auth/login', { email: uniq(), password: PW });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json).toEqual(b.json);
  });

  it('login, /me, refresh rotativo y detección de reutilización', async () => {
    const email = await activeUser();
    const login = await api('/api/auth/login', { email, password: PW });
    expect(login.status).toBe(200);
    const me = await fetch(base + '/api/auth/me', { headers: { authorization: `Bearer ${login.json.accessToken}` } });
    expect(((await me.json()) as { role: string }).role).toBe('CLIENTE');
    expect((await fetch(base + '/api/auth/me')).status).toBe(401);

    const r1 = await api('/api/auth/refresh', undefined, login.cookie);
    expect(r1.status).toBe(200);
    // Reutilizar el token anterior de inmediato (dos pestañas a la vez) falla, pero no cierra las demás sesiones.
    expect((await api('/api/auth/refresh', undefined, login.cookie)).status).toBe(401);
    const r2 = await api('/api/auth/refresh', undefined, r1.cookie);
    expect(r2.status).toBe(200);
    // Reutilizarlo mucho después sí se trata como robo y cierra todas las sesiones.
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } });
    expect((await api('/api/auth/refresh', undefined, login.cookie)).status).toBe(401);
    expect((await api('/api/auth/refresh', undefined, r2.cookie)).status).toBe(401);
  });

  it('logout invalida el refresh token y reutilizarlo después no cierra las otras sesiones', async () => {
    const email = await activeUser();
    const phone = await api('/api/auth/login', { email, password: PW });
    const pc = await api('/api/auth/login', { email, password: PW });
    await api('/api/auth/logout', undefined, pc.cookie);
    expect((await api('/api/auth/refresh', undefined, pc.cookie)).status).toBe(401);
    // aunque pase tiempo, esa cookie ya no existe: es un 401 normal, no un «robo»
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: { not: null } } })).toBe(0);
    expect((await api('/api/auth/refresh', undefined, phone.cookie)).status).toBe(200); // el móvil sigue con sesión
  });

  it('el JWT solo se acepta con el algoritmo esperado (HS256)', async () => {
    const email = await activeUser();
    const login = await api('/api/auth/login', { email, password: PW });
    const payload = Buffer.from(JSON.stringify({ sub: String(login.json.user.id), role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    const noneToken = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${payload}.`;
    const hs512 = (await import('jsonwebtoken')).default.sign({ role: 'ADMIN' }, (await import('../src/lib/env.js')).env.jwtSecret, { subject: String(login.json.user.id), algorithm: 'HS512' });
    for (const t of [noneToken, hs512]) {
      const res = await fetch(base + '/api/auth/me', { headers: { authorization: `Bearer ${t}` } });
      expect(res.status).toBe(401);
    }
    const ok = await fetch(base + '/api/auth/me', { headers: { authorization: `Bearer ${login.json.accessToken}` } });
    expect(ok.status).toBe(200);
  });
});

describe('recuperación de contraseña', () => {
  it('respuesta genérica y sin correo si el usuario no existe', async () => {
    const r = await api('/api/auth/forgot-password', { email: uniq() });
    expect(r.status).toBe(202);
    expect(sent).toHaveLength(0);
  });

  it('cambia la contraseña, invalida el token y las sesiones previas', async () => {
    const email = await activeUser();
    const session = await api('/api/auth/login', { email, password: PW });
    expect((await api('/api/auth/forgot-password', { email })).status).toBe(202);
    const token = tokenOf(mails(email, 'AUTH_PASSWORD_RESET')[0]);

    const NEW = 'NuevaClave456x';
    const ok = await api('/api/auth/reset-password', { token, password: NEW, confirmPassword: NEW });
    expect(ok.status).toBe(200);
    expect(mails(email, 'AUTH_PASSWORD_CHANGED')).toHaveLength(1);

    // un solo uso
    expect((await api('/api/auth/reset-password', { token, password: 'OtraClave789y', confirmPassword: 'OtraClave789y' })).status).toBe(400);
    // la sesión anterior quedó invalidada
    expect((await api('/api/auth/refresh', undefined, session.cookie)).status).toBe(401);
    // la contraseña vieja ya no sirve; la nueva sí
    expect((await api('/api/auth/login', { email, password: PW })).status).toBe(401);
    expect((await api('/api/auth/login', { email, password: NEW })).status).toBe(200);
  });

  it('rechaza contraseña débil en el reset', async () => {
    const email = await activeUser();
    await api('/api/auth/forgot-password', { email });
    const token = tokenOf(mails(email, 'AUTH_PASSWORD_RESET')[0]);
    expect((await api('/api/auth/reset-password', { token, password: 'corta', confirmPassword: 'corta' })).status).toBe(400);
  });
});

describe('activar la cuenta exige el enlace Y la contraseña del registro (contra el pre-secuestro)', () => {
  const ATTACKER_PW = 'ClaveDelAtacante99';

  it('una contraseña equivocada no activa la cuenta ni gasta el enlace; la correcta sí', async () => {
    const email = uniq();
    await register(email);
    const token = tokenOf(mails(email, 'AUTH_VERIFY_EMAIL')[0]);
    const bad = await api('/api/auth/verify-email', { token, password: 'otra-clave-123' });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('WRONG_PASSWORD');
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).status).toBe('PENDING_EMAIL_VERIFICATION');
    expect((await api('/api/auth/verify-email', { token, password: PW })).status).toBe(200); // el enlace seguía vigente
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).status).toBe('ACTIVE');
  });

  it('un atacante que registra el email de otra persona no consigue controlar la cuenta', async () => {
    const victim = uniq('victima');
    // Existe la ficha del cliente: si la cuenta se activara, el atacante vería sus reparaciones.
    const rec = await prisma.role.findUniqueOrThrow({ where: { name: 'RECEPCION' } });
    const customer = await prisma.customer.create({ data: { name: 'Víctima', email: victim } });

    await register(victim, { password: ATTACKER_PW, confirmPassword: ATTACKER_PW }); // el atacante, con SU contraseña
    const token = tokenOf(mails(victim, 'AUTH_VERIFY_EMAIL')[0]); // el correo le llega a la víctima, no al atacante

    // La víctima hace clic y no conoce esa contraseña: no se activa.
    expect((await api('/api/auth/verify-email', { token, password: PW })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: victim } })).status).toBe('PENDING_EMAIL_VERIFICATION');
    // El atacante tiene la contraseña pero no el enlace: sin token válido no hay nada que hacer, ni login.
    expect((await api('/api/auth/verify-email', { token: 'x'.repeat(43), password: ATTACKER_PW })).status).toBe(400);
    expect((await api('/api/auth/login', { email: victim, password: ATTACKER_PW })).status).toBe(403); // pendiente: no entra
    expect((await prisma.user.findUniqueOrThrow({ where: { email: victim } })).customerId).toBeNull();

    // La víctima recupera la cuenta por «olvidé mi contraseña» (prueba que controla el buzón) y elige la suya.
    expect((await api('/api/auth/forgot-password', { email: victim })).status).toBe(202);
    const resetToken = tokenOf(mails(victim, 'AUTH_PASSWORD_RESET')[0]);
    const MINE = 'ClaveDeLaVictima77';
    expect((await api('/api/auth/reset-password', { token: resetToken, password: MINE, confirmPassword: MINE })).status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: victim } });
    expect(u.status).toBe('ACTIVE');
    expect(u.customerId).toBe(customer.id);
    expect((await api('/api/auth/login', { email: victim, password: ATTACKER_PW })).status).toBe(401); // la del atacante ya no sirve
    expect((await api('/api/auth/login', { email: victim, password: MINE })).status).toBe(200);
    void rec;
    await prisma.user.update({ where: { id: u.id }, data: { customerId: null } });
    await prisma.customer.delete({ where: { id: customer.id } });
  });

  it('quien olvidó la contraseña del registro puede recuperar y activar su cuenta pendiente', async () => {
    const email = uniq();
    await register(email);
    await api('/api/auth/forgot-password', { email });
    expect(mails(email, 'AUTH_PASSWORD_RESET')).toHaveLength(1); // antes solo las cuentas activas recibían este correo
    const NEW = 'NuevaClave456x';
    await api('/api/auth/reset-password', { token: tokenOf(mails(email, 'AUTH_PASSWORD_RESET')[0]), password: NEW, confirmPassword: NEW });
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u).toMatchObject({ status: 'ACTIVE' });
    expect(u.emailVerifiedAt).not.toBeNull();
  });

  it('una cuenta deshabilitada sigue sin poder recuperarse por correo', async () => {
    const email = await activeUser();
    await prisma.user.update({ where: { email }, data: { status: 'DISABLED' } });
    sent.length = 0;
    await api('/api/auth/forgot-password', { email });
    expect(mails(email, 'AUTH_PASSWORD_RESET')).toHaveLength(0);
  });

  it('exige la contraseña en el cuerpo', async () => {
    expect((await api('/api/auth/verify-email', { token: 'abc' })).status).toBe(400);
  });
});
