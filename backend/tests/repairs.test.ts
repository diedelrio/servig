import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Los adjuntos de prueba van a un directorio temporal, no a ./uploads
const UPLOADS = mkdtempSync(join(tmpdir(), 'servig-test-'));
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
const { sniff } = await import('../src/lib/fileType.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@rep.local';
const uniq = (p = 'r') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

// Cabeceras mínimas válidas de cada formato
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
const PDF = Buffer.from('%PDF-1.4\n' + 'x'.repeat(40));
const EXE = Buffer.from('MZ' + 'x'.repeat(60));

async function api(path: string, opts: { method?: string; body?: object; auth?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const upload = (repairId: number, token: string, data: Buffer, name = 'foto.jpg') =>
  fetch(`${base}/api/repairs/${repairId}/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name) },
    body: data,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

async function userWith(role: string) {
  const email = uniq(role.toLowerCase());
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const u = await prisma.user.create({
    data: { email, firstName: 'T', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json.accessToken as string };
}

/** Cliente con una herramienta; devuelve ids. */
async function setup(token: string, customer: object = {}) {
  const c = await api('/api/customers', { method: 'POST', auth: token, body: { name: 'Cliente <b>Rep</b>', email: uniq('cli'), ...customer } });
  const t = await api('/api/tools', { method: 'POST', auth: token, body: { customerId: c.json.id, type: 'Taladro', brand: 'Bosch', model: 'GSB' } });
  return { customerId: c.json.id as number, toolId: t.json.id as number, email: c.json.email as string };
}

const reception = (token: string, toolId: number, over: object = {}) =>
  api('/api/repairs', { method: 'POST', auth: token, body: { toolId, declaredFault: 'No enciende', visualState: 'Carcasa rayada', ...over } });

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
  await cleanup(prisma, DOMAIN);
  server.close();
  await prisma.$disconnect();
  rmSync(UPLOADS, { recursive: true, force: true });
});

describe('detección de tipo de archivo', () => {
  it('reconoce JPG, PNG, WebP y PDF por contenido; rechaza el resto', () => {
    expect(sniff(JPG)?.mime).toBe('image/jpeg');
    expect(sniff(PNG)?.mime).toBe('image/png');
    expect(sniff(PDF)?.mime).toBe('application/pdf');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
    expect(sniff(webp)?.mime).toBe('image/webp');
    expect(sniff(EXE)).toBeNull();
    expect(sniff(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });
});

describe('recepción', () => {
  it('crea la reparación en RECIBIDO con número, historial inicial y receptor', async () => {
    const rec = await userWith('RECEPCION');
    const { toolId, customerId } = await setup(rec.token);
    const r = await reception(rec.token, toolId, { accessories: 'Maletín y batería' });
    expect(r.status).toBe(201);
    expect(r.json.number).toMatch(new RegExp(`^REP-${new Date().getFullYear()}-\\d{6}$`));
    expect(r.json.status).toBe('RECIBIDO');
    expect(r.json.customerId).toBe(customerId); // viene de la herramienta
    expect(r.json.receivedById).toBe(rec.id);

    const d = await api(`/api/repairs/${r.json.id}`, { auth: rec.token });
    expect(d.json.history).toHaveLength(1);
    expect(d.json.history[0]).toMatchObject({ fromStatus: null, toStatus: 'RECIBIDO', userId: rec.id, origin: 'STAFF' });
    expect(d.json.receivedBy.firstName).toBe('T');
    expect(d.json.business.name).toBeTruthy();
    const log = await prisma.auditLog.findFirst({ where: { action: 'REPAIR_CREATED', entityId: String(r.json.id) } });
    expect(log).not.toBeNull();
  });

  it('los números son únicos incluso en recepciones simultáneas', async () => {
    const rec = await userWith('RECEPCION');
    const { toolId } = await setup(rec.token);
    const results = await Promise.all(Array.from({ length: 8 }, () => reception(rec.token, toolId)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const nums = results.map((r) => Number(r.json.number.slice(-6))).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(8);
    // El contador es global: otros archivos de test pueden intercalar números, así que solo se exige unicidad.
    expect(nums[7] - nums[0]).toBeGreaterThanOrEqual(7);
  });

  it('envía el email "herramienta recibida" escapando el contenido del usuario', async () => {
    const rec = await userWith('RECEPCION');
    const { toolId, email } = await setup(rec.token);
    const r = await reception(rec.token, toolId, { declaredFault: '<script>alert(1)</script> no arranca' });
    const mail = sent.find((m) => m.to === email && m.type === 'REPAIR_RECEIVED')!;
    expect(mail.subject).toContain(r.json.number);
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Cliente &lt;b&gt;Rep&lt;/b&gt;');
  });

  it('un cliente sin email no genera correo pero la recepción funciona', async () => {
    const rec = await userWith('RECEPCION');
    const { toolId } = await setup(rec.token, { email: '' });
    expect((await reception(rec.token, toolId)).status).toBe(201);
    expect(sent.filter((m) => m.type === 'REPAIR_RECEIVED' && m.to.endsWith(DOMAIN) && m.to.includes('cli'))).toHaveLength(0);
  });

  it('valida campos obligatorios, herramienta inexistente y la regla de garantía (RN-02)', async () => {
    const rec = await userWith('RECEPCION');
    const { toolId } = await setup(rec.token);
    expect((await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId, declaredFault: '', visualState: 'x' } })).status).toBe(400);
    expect((await reception(rec.token, 999999999)).status).toBe(404);

    const sinGarantia = await reception(rec.token, toolId, { requiresQuote: false });
    expect(sinGarantia.status).toBe(400);
    const enGarantia = await reception(rec.token, toolId, { inWarranty: true, requiresQuote: false });
    expect(enGarantia.status).toBe(201);
    expect(enGarantia.json.requiresQuote).toBe(false);
    expect((await reception(rec.token, toolId)).json.requiresQuote).toBe(true); // por defecto sí
  });

  it('permisos: TECNICO consulta pero no recepciona; CLIENTE no accede; sin token 401', async () => {
    const rec = await userWith('RECEPCION');
    const { toolId } = await setup(rec.token);
    const r = await reception(rec.token, toolId);
    const tec = await userWith('TECNICO');
    const cli = await userWith('CLIENTE');
    expect((await api('/api/repairs')).status).toBe(401);
    expect((await api('/api/repairs', { auth: cli.token })).status).toBe(403);
    expect((await api(`/api/repairs/${r.json.id}`, { auth: cli.token })).status).toBe(403);
    expect((await api(`/api/repairs/${r.json.id}`, { auth: tec.token })).status).toBe(200);
    expect((await reception(tec.token, toolId)).status).toBe(403);
  });

  it('lista y filtra por estado, texto y cliente', async () => {
    const rec = await userWith('RECEPCION');
    const { toolId, customerId } = await setup(rec.token);
    const r = await reception(rec.token, toolId);
    const byNumber = await api(`/api/repairs?search=${r.json.number}`, { auth: rec.token });
    expect(byNumber.json.map((x: { id: number }) => x.id)).toEqual([r.json.id]);
    expect((await api(`/api/repairs?customerId=${customerId}&status=RECIBIDO`, { auth: rec.token })).json).toHaveLength(1);
    expect((await api(`/api/repairs?customerId=${customerId}&status=ENTREGADO`, { auth: rec.token })).json).toHaveLength(0);
    expect((await api('/api/repairs?search=bosch', { auth: rec.token })).json.length).toBeGreaterThan(0);
  });
});

describe('adjuntos', () => {
  it('sube imagen y PDF, los lista y los descarga idénticos', async () => {
    const rec = await userWith('RECEPCION');
    const { toolId } = await setup(rec.token);
    const r = await reception(rec.token, toolId);

    const a = await upload(r.json.id, rec.token, JPG, 'frente ñandú.jpg');
    expect(a.status).toBe(201);
    expect(a.json).toMatchObject({ filename: 'frente ñandú.jpg', mime: 'image/jpeg', size: JPG.length });
    expect((await upload(r.json.id, rec.token, PDF, 'garantia.pdf')).status).toBe(201);

    const d = await api(`/api/repairs/${r.json.id}`, { auth: rec.token });
    expect(d.json.attachments).toHaveLength(2);

    const dl = await fetch(`${base}/api/repairs/${r.json.id}/attachments/${a.json.id}`, { headers: { authorization: `Bearer ${rec.token}` } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await dl.arrayBuffer()).equals(JPG)).toBe(true);
  });

  it('rechaza formatos peligrosos aunque declaren otro tipo, vacíos y demasiado grandes', async () => {
    const rec = await userWith('RECEPCION');
    const { toolId } = await setup(rec.token);
    const r = await reception(rec.token, toolId);
    expect((await upload(r.json.id, rec.token, EXE, 'virus.jpg')).status).toBe(415);
    expect((await upload(r.json.id, rec.token, Buffer.from('<html><script>1</script>'), 'x.png')).status).toBe(415);
    expect((await upload(r.json.id, rec.token, Buffer.alloc(0))).status).toBe(400);
    const big = Buffer.concat([JPG, Buffer.alloc(11 * 1024 * 1024)]);
    expect((await upload(r.json.id, rec.token, big)).status).toBe(413);
  });

  it('sanea el nombre, exige permiso y no mezcla adjuntos entre reparaciones', async () => {
    const rec = await userWith('RECEPCION');
    const cli = await userWith('CLIENTE');
    const { toolId } = await setup(rec.token);
    const r1 = await reception(rec.token, toolId);
    const r2 = await reception(rec.token, toolId);

    expect((await upload(r1.json.id, cli.token, JPG)).status).toBe(403);
    expect((await upload(999999999, rec.token, JPG)).status).toBe(404);

    const a = await upload(r1.json.id, rec.token, PNG, '../../etc/passwd');
    expect(a.json.filename).not.toContain('/');
    const cross = await fetch(`${base}/api/repairs/${r2.json.id}/attachments/${a.json.id}`, { headers: { authorization: `Bearer ${rec.token}` } });
    expect(cross.status).toBe(404);
    const tec = await userWith('TECNICO');
    expect((await upload(r1.json.id, tec.token, PDF, 'informe.pdf')).status).toBe(201); // el técnico también adjunta
  });
});
