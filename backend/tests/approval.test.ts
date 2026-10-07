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
const { hashPassword, hashToken } = await import('../src/lib/security.js');
const { expireDueQuotes } = await import('../src/modules/quotes/service.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@apr.local';
const uniq = (p = 'a') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

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
    data: { email, firstName: 'Téc', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json.accessToken as string };
}

type Staff = Awaited<ReturnType<typeof userWith>>;
let rec: Staff, tec: Staff, adm: Staff;

const ITEMS = [
  { type: 'LABOR', description: 'Mano de obra', quantity: 1, unitPrice: 50, taxRate: 21 },
  { type: 'PART', description: 'Escobillas', quantity: 2, unitPrice: 10, taxRate: 21 },
];

/** Reparación con presupuesto ENVIADO y su enlace real (extraído del correo, como lo haría el cliente). */
async function pending(opts: { requiresQuote?: boolean } = {}) {
  const customerEmail = uniq('cli');
  const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Ana <Cliente>', email: customerEmail, phone: '600123456', address: 'Calle Secreta 1' } });
  const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'Taladro', brand: 'Bosch', model: 'AP1' } });
  const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'No gira', visualState: 'Ok', ...opts } });
  const id = r.json.id as number;
  await api(`/api/repairs/${id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
  await api(`/api/repairs/${id}/diagnosis`, { method: 'POST', auth: tec.token, body: { text: 'Visible al cliente', visibleToCustomer: true } });
  await api(`/api/repairs/${id}/diagnosis`, { method: 'POST', auth: tec.token, body: { text: 'SECRETO interno', visibleToCustomer: false } });
  await api(`/api/repairs/${id}/quote`, { method: 'PUT', auth: tec.token, body: { items: ITEMS } });
  await api(`/api/repairs/${id}/quote/send`, { method: 'POST', auth: tec.token });
  return { id, customerEmail, token: tokenFrom(customerEmail) };
}

const tokenFrom = (to: string, nth = -1) => {
  const mails = sent.filter((m) => m.to === to && m.type === 'QUOTE_AVAILABLE');
  const m = nth < 0 ? mails[mails.length + nth] : mails[nth];
  return decodeURIComponent(m.html.match(/quote-approval\?token=([^"]+)"/)![1]);
};

const view = (token: string) => api(`/api/public/quote-approval/${encodeURIComponent(token)}`);
const decide = (token: string, decision: string, comment?: string) =>
  api(`/api/public/quote-approval/${encodeURIComponent(token)}/decision`, { method: 'POST', body: { decision, comment } });
const statusOf = async (id: number) => (await prisma.repair.findUniqueOrThrow({ where: { id } })).status as RepairStatus;
const go = (id: number, to: string, who: Staff, comment?: string) =>
  api(`/api/repairs/${id}/transition`, { method: 'POST', auth: who.token, body: { to, comment } });

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

describe('enlace y vista pública', () => {
  it('el correo trae un enlace de aprobación y en la base solo queda el hash del token', async () => {
    const p = await pending();
    expect(p.token.length).toBeGreaterThanOrEqual(40);
    const mail = sent.find((m) => m.to === p.customerEmail && m.type === 'QUOTE_AVAILABLE')!;
    expect(mail.html).toContain('/quote-approval?token=');
    const rows = await prisma.quoteLinkToken.findMany({ where: { version: { quote: { repairId: p.id } } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(p.token));
    expect(rows[0].tokenHash).not.toContain(p.token);
    const days = (rows[0].expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('muestra el presupuesto sin datos sensibles ni diagnósticos internos, y sin necesitar sesión', async () => {
    const p = await pending();
    const v = await view(p.token);
    expect(v.status).toBe(200);
    expect(v.json.state).toBe('OPEN');
    expect(v.json.customerName).toBe('Ana <Cliente>');
    expect(v.json.quote.total).toBe('84.70'); // 50 + 20 = 70 + 21 % = 84,70
    expect(v.json.quote.items).toHaveLength(2);
    expect(v.json.diagnoses.map((d: { text: string }) => d.text)).toEqual(['Visible al cliente']);
    const raw = JSON.stringify(v.json);
    for (const secret of ['SECRETO', '600123456', 'Calle Secreta', p.customerEmail]) expect(raw).not.toContain(secret);
  });

  it('un token inventado da 404 genérico', async () => {
    expect((await view('x'.repeat(43))).status).toBe(404);
    expect((await decide('x'.repeat(43), 'APPROVE')).status).toBe(404);
  });
});

describe('aprobación', () => {
  it('registra la decisión completa y habilita la reparación (RN-01)', async () => {
    const p = await pending();
    expect((await go(p.id, 'EN_REPARACION', tec)).status).toBe(409); // todavía no

    const res = await decide(p.token, 'APPROVE');
    expect(res.status).toBe(200);
    expect(await statusOf(p.id)).toBe('PRESUPUESTO_APROBADO');

    const v = await prisma.quoteVersion.findFirstOrThrow({ where: { quote: { repairId: p.id } }, include: { approval: true } });
    expect(v.status).toBe('APROBADO');
    expect(v.approval).toMatchObject({ decision: 'APROBADO', origin: 'CUSTOMER_LINK', userId: null });
    expect(v.approval!.ip).toBeTruthy();
    expect(v.approval!.userAgent).toBeTruthy();
    expect(v.approval!.decidedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);

    const h = await prisma.repairStatusHistory.findFirstOrThrow({ where: { repairId: p.id, toStatus: 'PRESUPUESTO_APROBADO' } });
    expect(h).toMatchObject({ fromStatus: 'PRESUPUESTO_PENDIENTE_APROBACION', origin: 'CUSTOMER_LINK', userId: null });
    expect(await prisma.auditLog.count({ where: { action: 'QUOTE_APPROVED', entityId: String(p.id) } })).toBe(1);

    expect((await go(p.id, 'EN_REPARACION', tec)).status).toBe(200); // ahora sí
  });

  it('avisa al cliente y al técnico que envió el presupuesto', async () => {
    const p = await pending();
    sent.length = 0;
    await decide(p.token, 'APPROVE');
    const toCustomer = sent.find((m) => m.to === p.customerEmail)!;
    expect(toCustomer.type).toBe('QUOTE_APPROVED');
    expect(toCustomer.html).toContain('84.70');
    expect(toCustomer.html).toContain('Ana &lt;Cliente&gt;');
    const toStaff = sent.find((m) => m.to === tec.email)!;
    expect(toStaff.type).toBe('STAFF_QUOTE_DECISION');
    expect(toStaff.subject).toContain('aprobó');
  });

  it('también el estado de la vista pública pasa a DECIDED', async () => {
    const p = await pending();
    await decide(p.token, 'APPROVE');
    const v = await view(p.token);
    expect(v.json.state).toBe('DECIDED');
    expect(v.json.decision.decision).toBe('APROBADO');
  });
});

describe('rechazo', () => {
  it('registra el motivo, avisa y deja rehacer el presupuesto', async () => {
    const p = await pending();
    const res = await decide(p.token, 'REJECT', 'Demasiado caro');
    expect(res.status).toBe(200);
    expect(await statusOf(p.id)).toBe('PRESUPUESTO_RECHAZADO');
    const v = await prisma.quoteVersion.findFirstOrThrow({ where: { quote: { repairId: p.id } }, include: { approval: true } });
    expect(v.status).toBe('RECHAZADO');
    expect(v.approval).toMatchObject({ decision: 'RECHAZADO', comment: 'Demasiado caro' });
    expect(sent.find((m) => m.to === tec.email)!.html).toContain('Demasiado caro');
    expect((await go(p.id, 'EN_REPARACION', adm)).status).toBe(409); // rechazado: no se repara

    // ciclo de corrección: revisión → nueva versión → reenvío con enlace nuevo
    expect((await go(p.id, 'EN_REVISION', tec)).status).toBe(200);
    expect((await api(`/api/repairs/${p.id}/quote/new-version`, { method: 'POST', auth: tec.token })).status).toBe(201);
    expect((await api(`/api/repairs/${p.id}/quote/send`, { method: 'POST', auth: tec.token })).status).toBe(200);
    const newToken = tokenFrom(p.customerEmail);
    expect(newToken).not.toBe(p.token);
    expect((await decide(newToken, 'APPROVE')).status).toBe(200);
    expect(await statusOf(p.id)).toBe('PRESUPUESTO_APROBADO');
  });
});

describe('un solo uso y carreras', () => {
  it('el enlace no se puede reutilizar, ni para la misma decisión ni para la contraria', async () => {
    const p = await pending();
    expect((await decide(p.token, 'APPROVE')).status).toBe(200);
    for (const d of ['APPROVE', 'REJECT']) {
      const again = await decide(p.token, d);
      expect(again.status).toBe(409);
      expect(again.json.code).toBe('ALREADY_DECIDED');
    }
    expect(await statusOf(p.id)).toBe('PRESUPUESTO_APROBADO');
    expect(await prisma.quoteApproval.count({ where: { version: { quote: { repairId: p.id } } } })).toBe(1);
  });

  it('aprobar y rechazar a la vez: gana una sola decisión y todo queda coherente', async () => {
    const p = await pending();
    const [a, b] = await Promise.all([decide(p.token, 'APPROVE'), decide(p.token, 'REJECT')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const approvals = await prisma.quoteApproval.findMany({ where: { version: { quote: { repairId: p.id } } }, include: { version: true } });
    expect(approvals).toHaveLength(1);
    const final = await statusOf(p.id);
    expect(final).toBe(approvals[0].decision === 'APROBADO' ? 'PRESUPUESTO_APROBADO' : 'PRESUPUESTO_RECHAZADO');
    expect(approvals[0].version.status).toBe(approvals[0].decision);
    expect(await prisma.repairStatusHistory.count({ where: { repairId: p.id, fromStatus: 'PRESUPUESTO_PENDIENTE_APROBACION' } })).toBe(1);
    expect(sent.filter((m) => m.type === 'QUOTE_APPROVED' || m.type === 'QUOTE_REJECTED')).toHaveLength(1);
  });

  it('valida el cuerpo: decisión desconocida o faltante', async () => {
    const p = await pending();
    expect((await decide(p.token, 'TAL_VEZ')).status).toBe(400);
    expect((await api(`/api/public/quote-approval/${p.token}/decision`, { method: 'POST', body: {} })).status).toBe(400);
    expect(await statusOf(p.id)).toBe('PRESUPUESTO_PENDIENTE_APROBACION');
  });
});

describe('enlace vencido, presupuesto vencido o retirado', () => {
  it('enlace vencido: no decide y pide uno nuevo; el presupuesto sigue vigente', async () => {
    const p = await pending();
    await prisma.quoteLinkToken.updateMany({ where: { version: { quote: { repairId: p.id } } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await view(p.token)).json.state).toBe('LINK_EXPIRED');
    const res = await decide(p.token, 'APPROVE');
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('LINK_EXPIRED');
    expect(await statusOf(p.id)).toBe('PRESUPUESTO_PENDIENTE_APROBACION');

    // el taller reenvía el enlace: el viejo deja de valer y el nuevo funciona
    sent.length = 0;
    expect((await api(`/api/repairs/${p.id}/quote/resend-link`, { method: 'POST', auth: tec.token })).status).toBe(200);
    const fresh = tokenFrom(p.customerEmail);
    expect(fresh).not.toBe(p.token);
    expect((await decide(fresh, 'APPROVE')).status).toBe(200);
  });

  it('reenviar el enlace invalida el anterior (aunque no hubiera vencido)', async () => {
    const p = await pending();
    await api(`/api/repairs/${p.id}/quote/resend-link`, { method: 'POST', auth: tec.token });
    const old = await decide(p.token, 'APPROVE');
    expect(old.status).toBe(409);
    expect(old.json.code).toBe('LINK_REPLACED');
    expect((await view(p.token)).json.state).toBe('REPLACED');
    expect((await decide(tokenFrom(p.customerEmail), 'APPROVE')).status).toBe(200);
  });

  it('presupuesto vencido: no se puede aprobar', async () => {
    const p = await pending();
    await prisma.quoteVersion.updateMany({ where: { quote: { repairId: p.id } }, data: { validUntil: new Date(Date.now() - 1000) } });
    // sin que haya corrido el barrido: la propia decisión lo detecta
    const res = await decide(p.token, 'APPROVE');
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('QUOTE_EXPIRED');
    expect((await view(p.token)).json.state).toBe('EXPIRED');
    expect(await statusOf(p.id)).toBe('PRESUPUESTO_PENDIENTE_APROBACION');
    expect(await expireDueQuotes()).toBe(0); // ya estaba marcado
  });

  it('presupuesto retirado: el enlace viejo no decide, tampoco contra la versión nueva', async () => {
    const p = await pending();
    await api(`/api/repairs/${p.id}/quote/withdraw`, { method: 'POST', auth: tec.token, body: { comment: 'Error de precio' } });
    expect((await view(p.token)).json.state).toBe('WITHDRAWN');
    const res = await decide(p.token, 'APPROVE');
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('QUOTE_WITHDRAWN');
    expect((await view(p.token)).json.quote).toBeUndefined(); // no muestra importes obsoletos

    await api(`/api/repairs/${p.id}/quote/new-version`, { method: 'POST', auth: tec.token });
    await api(`/api/repairs/${p.id}/quote/send`, { method: 'POST', auth: tec.token });
    expect((await decide(p.token, 'APPROVE')).status).toBe(409); // el viejo sigue sin valer
    expect((await decide(tokenFrom(p.customerEmail), 'APPROVE')).status).toBe(200);
  });
});

describe('RN-01 y límites', () => {
  it('el personal no puede aprobar ni rechazar por la API de transiciones, ni siquiera ADMIN', async () => {
    const p = await pending();
    for (const to of ['PRESUPUESTO_APROBADO', 'PRESUPUESTO_RECHAZADO', 'EN_REPARACION']) {
      for (const who of [tec, adm, rec]) {
        const res = await go(p.id, to, who);
        expect([403, 409], `${to} ${who.email}`).toContain(res.status);
      }
    }
    expect(await statusOf(p.id)).toBe('PRESUPUESTO_PENDIENTE_APROBACION');
  });

  it('un presupuesto no se puede decidir una vez cancelada la reparación', async () => {
    const p = await pending();
    await go(p.id, 'CANCELADO', adm, 'El cliente llamó');
    const res = await decide(p.token, 'APPROVE');
    expect(res.status).toBe(409);
    expect(await statusOf(p.id)).toBe('CANCELADO');
  });

  it('el staff ve en el presupuesto quién decidió, cuándo y desde dónde', async () => {
    const p = await pending();
    await decide(p.token, 'REJECT', 'No me interesa');
    const q = await api(`/api/repairs/${p.id}/quote`, { auth: rec.token });
    const approval = q.json.quote.versions[0].approval;
    expect(approval).toMatchObject({ decision: 'RECHAZADO', origin: 'CUSTOMER_LINK', comment: 'No me interesa' });
    expect(approval.ip).toBeTruthy();
    expect(approval.decidedAt).toBeTruthy();
  });

  it('reenviar enlace exige un presupuesto pendiente y permiso de escritura', async () => {
    const p = await pending();
    expect((await api(`/api/repairs/${p.id}/quote/resend-link`, { method: 'POST', auth: rec.token })).status).toBe(403);
    await decide(p.token, 'APPROVE');
    const res = await api(`/api/repairs/${p.id}/quote/resend-link`, { method: 'POST', auth: tec.token });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('NOTHING_PENDING');
  });
});
