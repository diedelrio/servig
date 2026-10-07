import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';

// OJO: aquí NO se simula el módulo de correo; se usa el real con un transporte falso.
const { cleanup } = await import('./cleanup.js');
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/security.js');
const { sendEmail, retryFailedEmails, setTransport, SENSITIVE_TYPES, MAX_ATTEMPTS } = await import('../src/lib/email.js');
const { env } = await import('../src/lib/env.js');

import type { Mail, Transport } from '../src/lib/email.js';

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@em.local';
const uniq = (p = 'e') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

/** Transporte falso: guarda lo enviado y falla las N primeras veces (o siempre). */
function fake(failFirst = 0) {
  const t = { sent: [] as Mail[], calls: 0, failFirst, failAlways: false } as { sent: Mail[]; calls: number; failFirst: number; failAlways: boolean } & Transport;
  t.send = async (m) => {
    t.calls++;
    if (t.failAlways || t.calls <= t.failFirst) throw new Error('SMTP caído (simulado)');
    t.sent.push(m);
  };
  return t;
}

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
let adm: Staff, rec: Staff, tec: Staff, cli: Staff;
let transport = fake();

const send = (type: string, to = uniq('dest'), html = '<p>cuerpo</p>') => sendEmail({ to, type, subject: `Asunto ${type}`, html, entity: 'Repair', entityId: '7' });
const logOf = (to: string) => prisma.emailLog.findFirstOrThrow({ where: { to }, orderBy: { id: 'desc' } });
/** Crea un registro FAILED listo para reintento. */
const failedRow = (over: Partial<{ attempts: number; ago: number; html: string | null; type: string }> = {}) =>
  prisma.emailLog.create({
    data: {
      to: uniq('fail'), type: over.type ?? 'REPAIR_READY', subject: 'Pendiente', status: 'FAILED', error: 'x',
      attempts: over.attempts ?? 3, html: over.html === undefined ? '<p>reintentar</p>' : over.html,
      lastAttemptAt: new Date(Date.now() - (over.ago ?? 60) * 60_000),
    },
  });

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  transport = fake();
  setTransport(transport);
  [adm, rec, tec, cli] = await Promise.all([userWith('ADMIN'), userWith('RECEPCION'), userWith('TECNICO'), userWith('CLIENTE')]);
});

beforeEach(() => {
  transport = fake();
  setTransport(transport);
});

afterAll(async () => {
  await cleanup(prisma, DOMAIN);
  server.close();
  await prisma.$disconnect();
});

describe('envío y registro', () => {
  it('envía con el remitente configurado y deja el registro completo', async () => {
    const to = uniq('ok');
    expect(await send('REPAIR_RECEIVED', to)).toBe(true);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({ to, from: env.emailFrom, subject: 'Asunto REPAIR_RECEIVED' });
    const log = await logOf(to);
    expect(log).toMatchObject({ type: 'REPAIR_RECEIVED', subject: 'Asunto REPAIR_RECEIVED', entity: 'Repair', entityId: '7', status: 'SENT', attempts: 1, error: null });
    expect(log.sentAt).toBeTruthy();
    expect(log.createdAt).toBeTruthy();
    expect(log.html).toBe('<p>cuerpo</p>'); // sin enlaces de un solo uso: se conserva para poder reintentar
  });

  it('los correos con enlaces de un solo uso se envían pero NO guardan su cuerpo', async () => {
    expect([...SENSITIVE_TYPES].sort()).toEqual(['AUTH_INVITE', 'AUTH_PASSWORD_RESET', 'AUTH_VERIFY_EMAIL', 'QUOTE_AVAILABLE']);
    for (const type of SENSITIVE_TYPES) {
      const to = uniq('sens');
      expect(await send(type, to, '<a href="https://x/y?token=SECRETO123">enlace</a>')).toBe(true);
      expect(transport.sent.at(-1)!.html).toContain('SECRETO123'); // al destinatario sí le llega
      const log = await logOf(to);
      expect(log.html, type).toBeNull();
      expect(JSON.stringify(log)).not.toContain('SECRETO123');
    }
  });

  it('un fallo transitorio se reintenta dentro del propio envío', async () => {
    transport = fake(2); // falla 2 veces y a la 3.ª sale
    setTransport(transport);
    const to = uniq('flaky');
    expect(await send('REPAIR_READY', to)).toBe(true);
    expect(transport.calls).toBe(3);
    expect(await logOf(to)).toMatchObject({ status: 'SENT', attempts: 3, error: null });
  });

  it('un fallo permanente no lanza, queda FAILED con el error y los intentos', async () => {
    transport.failAlways = true;
    const to = uniq('down');
    await expect(send('REPAIR_READY', to)).resolves.toBe(false);
    const log = await logOf(to);
    expect(log).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(log.error).toContain('SMTP caído');
    expect(log.sentAt).toBeNull();
    expect(log.lastAttemptAt).toBeTruthy();
  });

  it('el proveedor es intercambiable: otro Transport recibe el mismo mensaje', async () => {
    const received: Mail[] = [];
    setTransport({ send: async (m) => void received.push(m) });
    await send('REPAIR_FINISHED', uniq('swap'));
    expect(received).toHaveLength(1);
    expect(received[0].from).toBe(env.emailFrom);
    expect(transport.calls).toBe(0);
  });
});

describe('reintentos en segundo plano', () => {
  it('reenvía los fallidos con cuerpo cuyo tiempo de espera ya pasó', async () => {
    const row = await failedRow({ attempts: 3, ago: 60 });
    const r = await retryFailedEmails({ onlyIds: [row.id] });
    expect(r).toEqual({ retried: 1, ok: 1 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].html).toBe('<p>reintentar</p>');
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'SENT', attempts: 4, error: null });
  });

  it('respeta la espera creciente: 5 min tras el 3.º intento, 10 min tras el 4.º', async () => {
    const early = await failedRow({ attempts: 3, ago: 2 }); // esperó 2 de 5 min
    const second = await failedRow({ attempts: 4, ago: 7 }); // esperó 7 de 10 min
    const due = await failedRow({ attempts: 4, ago: 11 });
    const r = await retryFailedEmails({ onlyIds: [early.id, second.id, due.id] });
    expect(r.retried).toBe(1);
    expect((await prisma.emailLog.findUniqueOrThrow({ where: { id: due.id } })).status).toBe('SENT');
    expect((await prisma.emailLog.findUniqueOrThrow({ where: { id: early.id } })).status).toBe('FAILED');
    expect((await prisma.emailLog.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('FAILED');
  });

  it('se rinde al llegar al máximo de intentos y no reenvía lo que no tiene cuerpo', async () => {
    const exhausted = await failedRow({ attempts: MAX_ATTEMPTS, ago: 600 });
    const noBody = await failedRow({ html: null, type: 'AUTH_PASSWORD_RESET', ago: 600 });
    const r = await retryFailedEmails({ onlyIds: [exhausted.id, noBody.id] });
    expect(r).toEqual({ retried: 0, ok: 0 });
    expect(transport.calls).toBe(0);
  });

  it('si el reintento vuelve a fallar suma un intento y sigue FAILED', async () => {
    transport.failAlways = true;
    const row = await failedRow({ attempts: 3, ago: 60 });
    expect(await retryFailedEmails({ onlyIds: [row.id] })).toEqual({ retried: 1, ok: 0 });
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'FAILED', attempts: 4 });
  });
});

describe('vista del administrador', () => {
  it('solo ADMIN; anónimo 401', async () => {
    expect((await api('/api/email-logs')).status).toBe(401);
    for (const who of [rec, tec, cli]) {
      expect((await api('/api/email-logs', { auth: who.token })).status).toBe(403);
      expect((await api('/api/email-logs/1/retry', { method: 'POST', auth: who.token })).status).toBe(403);
    }
    expect((await api('/api/email-logs', { auth: adm.token })).status).toBe(200);
  });

  it('lista y filtra; nunca expone el cuerpo; indica cuáles se pueden reintentar', async () => {
    const withBody = await failedRow({ type: 'REPAIR_READY' });
    const noBody = await failedRow({ type: 'AUTH_PASSWORD_RESET', html: null });
    const dest = withBody.to;

    const byTo = await api(`/api/email-logs?to=${encodeURIComponent(dest)}`, { auth: adm.token });
    expect(byTo.json.items).toHaveLength(1);
    expect(byTo.json.items[0]).toMatchObject({ id: withBody.id, status: 'FAILED', canRetry: true, type: 'REPAIR_READY' });
    expect(JSON.stringify(byTo.json)).not.toContain('reintentar'); // el html no sale por la API
    expect(byTo.json.items[0]).not.toHaveProperty('html');

    const nb = await api(`/api/email-logs?to=${encodeURIComponent(noBody.to)}&status=FAILED&type=AUTH_PASSWORD_RESET`, { auth: adm.token });
    expect(nb.json.items[0].canRetry).toBe(false);
    expect((await api(`/api/email-logs?to=${encodeURIComponent(noBody.to)}&status=SENT`, { auth: adm.token })).json.items).toHaveLength(0);
    expect(byTo.json.failed).toBeGreaterThanOrEqual(2);
  });

  it('pagina por cursor sin repetir ni saltar', async () => {
    const tag = uniq('page').replace(DOMAIN, '');
    for (let i = 0; i < 5; i++) await prisma.emailLog.create({ data: { to: `${tag}-${i}${DOMAIN}`, type: 'REPAIR_READY', subject: 's', status: 'SENT' } });
    const seen: number[] = [];
    let cursor: number | null = null;
    for (let page = 0; page < 5; page++) {
      const res: { json: { items: { id: number }[]; nextCursor: number | null } } = await api(`/api/email-logs?to=${tag}&limit=2${cursor ? `&before=${cursor}` : ''}`, { auth: adm.token });
      seen.push(...res.json.items.map((i) => i.id));
      cursor = res.json.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort((a, b) => b - a)).toEqual(seen); // de más nuevo a más viejo
  });

  it('reintento manual: ok con cuerpo; 409 sin cuerpo, ya enviado; 404 inexistente; queda auditado', async () => {
    const row = await failedRow();
    const ok = await api(`/api/email-logs/${row.id}/retry`, { method: 'POST', auth: adm.token });
    expect(ok.status).toBe(200);
    expect(ok.json.result).toBe('SENT');
    expect(transport.sent).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'EMAIL_RETRIED', entityId: String(row.id), userId: adm.id } })).toBe(1);

    const again = await api(`/api/email-logs/${row.id}/retry`, { method: 'POST', auth: adm.token });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('NOT_FAILED');

    const sensitive = await failedRow({ html: null, type: 'AUTH_VERIFY_EMAIL' });
    const nb = await api(`/api/email-logs/${sensitive.id}/retry`, { method: 'POST', auth: adm.token });
    expect(nb.status).toBe(409);
    expect(nb.json.code).toBe('NO_BODY');

    expect((await api('/api/email-logs/999999999/retry', { method: 'POST', auth: adm.token })).status).toBe(404);
  });

  it('el reintento manual que vuelve a fallar informa FAILED', async () => {
    transport.failAlways = true;
    const row = await failedRow();
    const res = await api(`/api/email-logs/${row.id}/retry`, { method: 'POST', auth: adm.token });
    expect(res.status).toBe(200);
    expect(res.json.result).toBe('FAILED');
  });
});

describe('cobertura de correos transaccionales', () => {
  it('cada correo del documento existe con su tipo y se registra', async () => {
    // Recorre el flujo real y comprueba que se emitieron los 10 tipos pedidos (más la invitación).
    const staffToken = rec.token;
    const customerEmail = uniq('cobertura');
    await api('/api/users', { method: 'POST', auth: adm.token, body: { firstName: 'N', lastName: 'U', email: uniq('inv'), role: 'TECNICO' } }); // AUTH_INVITE
    await api('/api/auth/register', { method: 'POST', body: { firstName: 'C', lastName: 'L', email: customerEmail, password: PW, confirmPassword: PW } }); // AUTH_VERIFY_EMAIL
    await api('/api/auth/forgot-password', { method: 'POST', body: { email: customerEmail } }); // no activo → sin correo
    const verifyMail = transport.sent.find((m) => m.to === customerEmail)!;
    const vt = decodeURIComponent(verifyMail.html.match(/token=([^"]+)"/)![1]);
    await api('/api/auth/verify-email', { method: 'POST', body: { token: vt, password: PW } });
    await api('/api/auth/forgot-password', { method: 'POST', body: { email: customerEmail } }); // AUTH_PASSWORD_RESET
    const rt = decodeURIComponent(transport.sent.filter((m) => m.to === customerEmail).at(-1)!.html.match(/token=([^"]+)"/)![1]);
    await api('/api/auth/reset-password', { method: 'POST', body: { token: rt, password: 'OtraClave123x', confirmPassword: 'OtraClave123x' } }); // AUTH_PASSWORD_CHANGED

    const c = await api('/api/customers', { method: 'POST', auth: staffToken, body: { name: 'Cobertura', email: customerEmail } });
    const t = await api('/api/tools', { method: 'POST', auth: staffToken, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
    const r = await api('/api/repairs', { method: 'POST', auth: staffToken, body: { toolId: t.json.id, declaredFault: 'f', visualState: 'v' } }); // REPAIR_RECEIVED
    const id = r.json.id;
    await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
    await api(`/api/repairs/${id}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'LABOR', description: 'x', quantity: 1, unitPrice: 10, taxRate: 21 }] } });
    await api(`/api/repairs/${id}/quote/send`, { method: 'POST', auth: tec.token }); // QUOTE_AVAILABLE
    const link = transport.sent.filter((m) => m.to === customerEmail).at(-1)!.html.match(/quote-approval\?token=([^"]+)"/)![1];
    await api(`/api/public/quote-approval/${link}/decision`, { method: 'POST', body: { decision: 'APPROVE' } }); // QUOTE_APPROVED
    await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REPARACION' } });
    await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'REPARADO' } }); // REPAIR_FINISHED
    await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'LISTO_PARA_RETIRAR' } }); // REPAIR_READY

    // un segundo flujo para el rechazo
    const r2 = await api('/api/repairs', { method: 'POST', auth: staffToken, body: { toolId: t.json.id, declaredFault: 'f2', visualState: 'v' } });
    await api(`/api/repairs/${r2.json.id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
    await api(`/api/repairs/${r2.json.id}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'LABOR', description: 'x', quantity: 1, unitPrice: 10, taxRate: 21 }] } });
    await api(`/api/repairs/${r2.json.id}/quote/send`, { method: 'POST', auth: tec.token });
    const link2 = transport.sent.filter((m) => m.to === customerEmail).at(-1)!.html.match(/quote-approval\?token=([^"]+)"/)![1];
    await api(`/api/public/quote-approval/${link2}/decision`, { method: 'POST', body: { decision: 'REJECT' } }); // QUOTE_REJECTED

    // reenvío de la confirmación de registro
    const pend = uniq('pend');
    await api('/api/auth/register', { method: 'POST', body: { firstName: 'P', lastName: 'E', email: pend, password: PW, confirmPassword: PW } });
    await prisma.emailVerificationToken.updateMany({ where: { user: { email: pend } }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await api('/api/auth/resend-verification', { method: 'POST', body: { email: pend } });

    const types = new Set((await prisma.emailLog.findMany({ where: { OR: [{ to: customerEmail }, { to: pend }] }, select: { type: true } })).map((l) => l.type));
    for (const t of ['AUTH_VERIFY_EMAIL', 'AUTH_PASSWORD_RESET', 'AUTH_PASSWORD_CHANGED', 'REPAIR_RECEIVED', 'QUOTE_AVAILABLE', 'QUOTE_APPROVED', 'QUOTE_REJECTED', 'REPAIR_FINISHED', 'REPAIR_READY']) {
      expect(types.has(t), t).toBe(true);
    }
    expect(await prisma.emailLog.count({ where: { to: pend, type: 'AUTH_VERIFY_EMAIL' } })).toBe(2); // registro + reenvío
    expect(await prisma.emailLog.count({ where: { type: 'AUTH_INVITE', to: { endsWith: DOMAIN } } })).toBeGreaterThanOrEqual(1);
    // y todos quedaron entregados al transporte
    expect(await prisma.emailLog.count({ where: { to: customerEmail, status: { not: 'SENT' } } })).toBe(0);
  });
});
