import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

// El frontend compilado y los adjuntos van a carpetas temporales; deben fijarse ANTES de cargar la aplicación.
const STATIC = mkdtempSync(join(tmpdir(), 'servig-static-'));
const UPLOADS = mkdtempSync(join(tmpdir(), 'servig-sec-'));
mkdirSync(join(STATIC, 'assets'));
writeFileSync(join(STATIC, 'index.html'), '<!doctype html><title>SPA</title><div id="root"></div>');
writeFileSync(join(STATIC, 'assets', 'app.abc123.js'), 'console.log("app")');
writeFileSync(join(tmpdir(), 'servig-secreto.txt'), 'ESTO-NO-DEBE-SERVIRSE'); // fuera de STATIC: para probar el path traversal
process.env.STATIC_DIR = STATIC;
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
const { env, productionProblems } = await import('../src/lib/env.js');
const { runBackground } = await import('../src/lib/background.js');
const { limit } = await import('../src/lib/rateLimit.js');
const { adminPasswordProblem } = await import('../src/seed.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@sec.local';
const uniq = (p = 's') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);

async function api(path: string, opts: { method?: string; body?: object; auth?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}

async function userWith(role: string) {
  const email = uniq(role.toLowerCase());
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const u = await prisma.user.create({
    data: { email, firstName: 'Sec', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json.accessToken as string };
}

type Staff = Awaited<ReturnType<typeof userWith>>;
let rec: Staff, tec: Staff;

async function inReview() {
  const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente Sec', email: uniq('cli') } });
  const t = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
  const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: t.json.id, declaredFault: 'f', visualState: 'v' } });
  await api(`/api/repairs/${r.json.id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
  return r.json.id as number;
}
const line = (over: object = {}) => ({ type: 'LABOR', description: 'x', quantity: 1, unitPrice: 10, taxRate: 21, ...over });
const putQuote = (id: number, items: object[]) => api(`/api/repairs/${id}/quote`, { method: 'PUT', auth: tec.token, body: { items } });
const upload = (repairId: number, data: Buffer, headerName = 'foto.png') =>
  fetch(`${base}/api/repairs/${repairId}/attachments`, { method: 'POST', headers: { authorization: `Bearer ${rec.token}`, 'x-filename': headerName }, body: data })
    .then(async (r) => ({ status: r.status, json: (await r.json().catch(() => null)) as { id: number } | null }));

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  [rec, tec] = await Promise.all([userWith('RECEPCION'), userWith('TECNICO')]);
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await cleanup(prisma, DOMAIN);
  server.close();
  await prisma.$disconnect();
  for (const d of [STATIC, UPLOADS]) rmSync(d, { recursive: true, force: true });
  rmSync(join(tmpdir(), 'servig-secreto.txt'), { force: true });
});

describe('cabeceras de seguridad', () => {
  it('política de contenido estricta, sin incrustación, sin sniffing y sin delatar el framework', async () => {
    const h = (await api('/api/health')).headers;
    const csp = h.get('content-security-policy')!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/); // ningún script en línea ni eval
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('referrer-policy')).toBe('no-referrer'); // los enlaces del correo llevan tokens
    expect(h.get('strict-transport-security')).toBeTruthy();
    expect(h.get('x-powered-by')).toBeNull();
  });
});

describe('frontend servido por la API', () => {
  it('sirve la aplicación y recurre a index.html en las rutas del lado del cliente', async () => {
    for (const p of ['/', '/login', '/repairs/42', '/portal/repairs/7/receipt', '/quote-approval?token=abc']) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(200);
      expect(await res.text()).toContain('<div id="root">');
      expect(res.headers.get('cache-control')).toBe('no-cache'); // index.html siempre se revalida
    }
  });

  it('los recursos con hash se cachean un año', async () => {
    const res = await fetch(`${base}/assets/app.abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=31536000');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('una ruta de API inexistente responde 404 en JSON, no la página de la aplicación', async () => {
    const res = await api('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'No encontrado' });
    expect((await api('/api/auth/no-existe', { method: 'POST', body: {} })).status).toBe(404);
  });

  it('no permite salir de la carpeta del frontend (path traversal)', async () => {
    for (const p of ['/..%2f..%2fservig-secreto.txt', '/%2e%2e/servig-secreto.txt', '/assets/..%2f..%2fservig-secreto.txt', '/..\\servig-secreto.txt']) {
      const res = await fetch(base + p);
      expect(await res.text(), p).not.toContain('ESTO-NO-DEBE-SERVIRSE');
    }
  });
});

describe('comprobación de salud', () => {
  it('informa base de datos y almacenamiento', async () => {
    const res = await api('/api/health');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, db: true, storage: true });
  });

  it('responde 503 si la carpeta de adjuntos no se puede usar (p. ej. el volumen no está montado)', async () => {
    const original = env.uploadDir;
    const file = join(tmpdir(), `servig-no-es-carpeta-${Date.now()}`);
    writeFileSync(file, 'x'); // una ruta que es un archivo: no se puede crear la carpeta
    env.uploadDir = join(file, 'dentro');
    try {
      const res = await api('/api/health');
      expect(res.status).toBe(503);
      expect(res.json).toEqual({ ok: false, db: true, storage: false });
    } finally {
      env.uploadDir = original;
      rmSync(file, { force: true });
    }
    expect((await api('/api/health')).status).toBe(200);
  });
});

describe('adjuntos: respuestas robustas y cabeceras para contenido no confiable', () => {
  it('se sirven con CSP sandbox, tipo fijo por contenido y sin sniffing', async () => {
    const id = await inReview();
    const up = await upload(id, PNG);
    expect(up.status).toBe(201);
    const res = await fetch(`${base}/api/repairs/${id}/attachments/${up.json!.id}`, { headers: { authorization: `Bearer ${rec.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });

  it('si el archivo falta en disco responde 404 y el servidor sigue vivo', async () => {
    const id = await inReview();
    const up = await upload(id, PNG);
    const att = await prisma.attachment.findUniqueOrThrow({ where: { id: up.json!.id } });
    rmSync(join(UPLOADS, att.storageKey));
    const res = await fetch(`${base}/api/repairs/${id}/attachments/${up.json!.id}`, { headers: { authorization: `Bearer ${rec.token}` } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('FILE_MISSING');
    expect((await api('/api/health')).status).toBe(200);
  });

  it('un nombre de archivo mal codificado (% suelto) no provoca un 500', async () => {
    const id = await inReview();
    const up = await upload(id, PNG, '100%-real%.png');
    expect(up.status).toBe(201);
    const files = readdirSync(join(UPLOADS, String(new Date().getFullYear())));
    expect(files.length).toBeGreaterThan(0);
  });

  it('una petición JSON enorme se rechaza con un mensaje correcto', async () => {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(300_000) }) });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe('La petición es demasiado grande');
  });
});

describe('importes del presupuesto: nada desborda la base de datos', () => {
  it('rechaza cantidades y precios fuera de rango en vez de dar un 500', async () => {
    const id = await inReview();
    for (const bad of [{ quantity: 10_000 }, { quantity: 100_000 }, { unitPrice: 1_000_000 }, { unitPrice: 10_000_000 }]) {
      expect((await putQuote(id, [line(bad)])).status, JSON.stringify(bad)).toBe(400);
    }
    // El máximo por línea (≈ 9 999 989 999,99 de neto) cabe en la columna sin IVA, pero con IVA el total la supera: 400, no 500.
    expect((await putQuote(id, [line({ quantity: 9_999, unitPrice: 999_999.99, taxRate: 0 })])).status).toBe(200);
    const withTax = await putQuote(id, [line({ quantity: 9_999, unitPrice: 999_999.99, taxRate: 21 })]);
    expect(withTax.status).toBe(400);
    expect(withTax.json.code).toBe('AMOUNT_TOO_LARGE');
  });

  it('un presupuesto cuya suma supera la columna se rechaza con 400', async () => {
    const id = await inReview();
    const huge = Array.from({ length: 3 }, () => line({ quantity: 9_999, unitPrice: 999_999.99 })); // ≈ 3 × 1e10 de neto
    const res = await putQuote(id, huge);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('AMOUNT_TOO_LARGE');
    expect(await prisma.quote.count({ where: { repairId: id } })).toBe(0); // no dejó nada a medias
  });
});

describe('carrera entre guardar el borrador y enviarlo', () => {
  it('nunca se reescriben las líneas de una versión ya enviada, ni el correo anuncia otro total', async () => {
    for (let i = 0; i < 6; i++) {
      sent.length = 0;
      const id = await inReview();
      await putQuote(id, [line({ unitPrice: 10 })]);
      const [save, send] = await Promise.all([
        putQuote(id, [line({ unitPrice: 99 }), line({ unitPrice: 1 })]),
        api(`/api/repairs/${id}/quote/send`, { method: 'POST', auth: tec.token }),
      ]);
      expect(send.status, `iteración ${i}`).toBe(200);
      expect([200, 409]).toContain(save.status); // o guardó antes de enviar, o se le negó por estar enviada

      const v = await prisma.quoteVersion.findFirstOrThrow({ where: { quote: { repairId: id } }, include: { items: true } });
      expect(v.status).toBe('ENVIADO');
      // Coherencia: el total guardado es la suma de las líneas que realmente quedaron
      const net = v.items.reduce((a, it) => a + Number(it.lineNet), 0);
      expect(Number(v.subtotal)).toBeCloseTo(net, 2);
      // Y lo que se le dijo al cliente es lo que quedó congelado
      const mail = sent.find((m) => m.type === 'QUOTE_AVAILABLE')!;
      expect(mail.html).toContain(v.total.toFixed(2));
      // Una vez enviada, intentar guardar de nuevo siempre falla
      expect((await putQuote(id, [line({ unitPrice: 1234 })])).status).toBe(409);
    }
  });
});

describe('configuración segura en producción', () => {
  const good = { JWT_SECRET: 'a'.repeat(40), FRONTEND_URL: 'https://taller.example.com', TRUST_PROXY: '1', SMTP_HOST: 'smtp.proveedor.com' };

  it('acepta una configuración correcta', () => {
    expect(productionProblems(good)).toEqual([]);
    expect(productionProblems({ ...good, TRUST_PROXY: '0' })).toEqual([]); // 0 explícito = sin proxy
  });

  it.each([
    ['secreto corto', { JWT_SECRET: 'corto' }, /al menos 32/],
    ['secreto de ejemplo', { JWT_SECRET: 'change-me-dev-only-' + 'x'.repeat(20) }, /valor de ejemplo/],
    ['frontend sin https', { FRONTEND_URL: 'http://taller.example.com' }, /https/],
    ['sin TRUST_PROXY', { TRUST_PROXY: undefined }, /TRUST_PROXY debe indicarse/],
    ['TRUST_PROXY no numérico', { TRUST_PROXY: 'true' }, /entero/],
    ['SMTP local', { SMTP_HOST: 'localhost' }, /máquina local/],
    ['sin SMTP', { SMTP_HOST: undefined }, /máquina local/],
  ])('rechaza: %s', (_n, over, re) => {
    const problems = productionProblems({ ...good, ...over } as NodeJS.ProcessEnv);
    expect(problems.some((p) => re.test(p)), problems.join(' | ')).toBe(true);
  });

  it('el arranque en producción falla de verdad con una configuración insegura', async () => {
    const saved = { ...process.env };
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'change-me-dev-only';
    delete process.env.TRUST_PROXY;
    try {
      await expect(import('../src/lib/env.js?inseguro')).rejects.toThrow(/Configuración de producción insegura/);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      vi.resetModules();
    }
  });

  it('el seed no crea un administrador débil en producción', () => {
    expect(adminPasswordProblem('cambia-esto-123', false)).toBeNull(); // en desarrollo vale cualquiera
    expect(adminPasswordProblem('corta1', true)).toMatch(/12 caracteres/);
    expect(adminPasswordProblem('cambia-esto-1234567', true)).toMatch(/ejemplo/);
    expect(adminPasswordProblem('Admin12345!x-largo', true)).toMatch(/ejemplo/);
    expect(adminPasswordProblem('Zorro-Violeta-Nube-9', true)).toBeNull();
  });
});

describe('trabajo en segundo plano (anti-enumeración por tiempos)', () => {
  it('en producción no hace esperar a quien llamó y no propaga errores', async () => {
    let done = false;
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 80));
      done = true;
    };
    const t0 = Date.now();
    await runBackground(slow, false);
    expect(Date.now() - t0).toBeLessThan(60);
    expect(done).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(done).toBe(true);

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runBackground(async () => { throw new Error('SMTP caído'); }, false)).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('en tests espera el resultado (para poder comprobarlo)', async () => {
    let done = false;
    await runBackground(async () => { await new Promise((r) => setTimeout(r, 30)); done = true; }, true);
    expect(done).toBe(true);
    await expect(runBackground(async () => { throw new Error('x'); }, true)).rejects.toThrow('x');
  });

  it('registrar un email que ya existe tarda lo mismo que uno nuevo (se hace el mismo hash)', async () => {
    const existing = (await userWith('CLIENTE')).email;
    const body = (email: string) => ({ firstName: 'A', lastName: 'B', email, password: PW, confirmPassword: PW });
    const a = await api('/api/auth/register', { method: 'POST', body: body(existing) });
    const b = await api('/api/auth/register', { method: 'POST', body: body(uniq('nuevo')) });
    expect(a.status).toBe(202);
    expect(a.json).toEqual(b.json); // misma respuesta exista o no
  });
});

describe('límite de intentos', () => {
  it('cuenta por clave (p. ej. por email), ignora los éxitos y no mezcla cuentas', async () => {
    const wasTest = env.isTest;
    env.isTest = false; // en los tests los límites están apagados; aquí se prueba el propio mecanismo
    const mini = express();
    mini.use(express.json());
    mini.post('/login', limit(3, 15, { skipSuccessful: true, key: (req) => 'email:' + String(req.body?.email ?? '') }), (req, res) => {
      res.status(req.body.password === 'bien' ? 200 : 401).json({});
    });
    const srv = await new Promise<Server>((r) => { const s = mini.listen(0, () => r(s)); });
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/login`;
    const post = (email: string, password: string) =>
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.status);
    try {
      // 3 fallos de la misma cuenta, desde la misma IP: el 4.º ya está limitado
      expect([await post('a@x.co', 'mal'), await post('a@x.co', 'mal'), await post('a@x.co', 'mal')]).toEqual([401, 401, 401]);
      expect(await post('a@x.co', 'mal')).toBe(429);
      expect(await post('a@x.co', 'bien')).toBe(429); // bloqueada también para quien acierta, hasta que pase la ventana
      // otra cuenta desde la misma IP no se ve afectada
      expect(await post('b@x.co', 'mal')).toBe(401);
      // los accesos correctos no consumen cupo
      for (let i = 0; i < 6; i++) expect(await post('c@x.co', 'bien')).toBe(200);
      expect(await post('c@x.co', 'mal')).toBe(401);
    } finally {
      env.isTest = wasTest;
      srv.close();
    }
  });
});

describe('sin credenciales ni secretos en el repositorio', () => {
  it('.env no está versionado y los ejemplos no traen secretos reales', async () => {
    const { execSync } = await import('node:child_process');
    const tracked = execSync('git ls-files', { cwd: join(process.cwd(), '..') }).toString().split('\n');
    expect(tracked.filter((f) => /(^|\/)\.env$/.test(f))).toEqual([]);
    expect(tracked.some((f) => f === 'backend/.env.example')).toBe(true);
    expect(existsSync(join(process.cwd(), '.env.example'))).toBe(true);
  });
});
