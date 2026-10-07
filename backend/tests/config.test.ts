import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

vi.mock('../src/lib/email.js', async (orig) => ({ ...(await orig<typeof import('../src/lib/email.js')>()), sendEmail: vi.fn(async () => true) }));

const { cleanup } = await import('./cleanup.js');
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/security.js');
const { env } = await import('../src/lib/env.js');
const settings = await import('../src/lib/settings.js');
const { dashboard } = await import('../src/modules/dashboard/service.js');
const ref = await import('../src/modules/config/reference.js');
const { RULES } = await import('../src/modules/repairs/workflow.js');

let server: Server;
let base: string;
const PW = 'ClaveSegura123';
const DOMAIN = '@cfg.local';
const uniq = (p = 'c') => `test-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${DOMAIN}`;

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
  const u = await prisma.user.create({ data: { email, firstName: 'Cfg', lastName: role, roleId: r.id, passwordHash: await hashPassword(PW), status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PW } });
  return { id: u.id, email, token: login.json.accessToken as string };
}
type Person = Awaited<ReturnType<typeof userWith>>;
let adm: Person, rec: Person, tec: Person, cli: Person;

const put = (key: string, value: unknown, who: Person = adm) => api(`/api/config/settings/${key}`, { method: 'PUT', auth: who.token, body: { value } as object });
const item = async (key: string) => (await api('/api/config/settings', { auth: adm.token })).json.flatMap((g: { items: { key: string }[] }) => g.items).find((i: { key: string }) => i.key === key);

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  [adm, rec, tec, cli] = await Promise.all([userWith('ADMIN'), userWith('RECEPCION'), userWith('TECNICO'), userWith('CLIENTE')]);
});
beforeEach(async () => {
  await settings.resetSetting(adm.id, 'test.sample');
});
afterAll(async () => {
  await settings.resetSetting(adm.id, 'test.sample');
  await prisma.auditLog.deleteMany({ where: { entity: 'Settings', entityId: 'test.sample' } });
  await cleanup(prisma, DOMAIN);
  server.close();
  await prisma.$disconnect();
});

describe('permisos: solo ADMIN', () => {
  it('anónimo 401; RECEPCION, TECNICO y CLIENTE 403 en lectura y escritura', async () => {
    const endpoints = ['/settings', '/reference/workflow', '/reference/roles', '/reference/tables', '/reference/catalogs', '/reference/system'];
    for (const e of endpoints) expect((await api(`/api/config${e}`)).status, e).toBe(401);
    for (const who of [rec, tec, cli]) {
      for (const e of endpoints) expect((await api(`/api/config${e}`, { auth: who.token })).status, `${who.email} ${e}`).toBe(403);
      expect((await put('test.sample', 9, who)).status).toBe(403);
      expect((await api('/api/config/settings/test.sample', { method: 'DELETE', auth: who.token })).status).toBe(403);
    }
    for (const e of endpoints) expect((await api(`/api/config${e}`, { auth: adm.token })).status, e).toBe(200);
  });
});

describe('parámetros editables', () => {
  it('lista todos agrupados, con valor efectivo, valor por defecto y de dónde viene', async () => {
    const groups = (await api('/api/config/settings', { auth: adm.token })).json as { group: string; items: Record<string, unknown>[] }[];
    expect(groups.map((g) => g.group)).toEqual(expect.arrayContaining(['Presupuestos', 'Atrasos', 'Datos del taller']));
    const all = groups.flatMap((g) => g.items);
    // 3 de presupuestos + 9 umbrales + 4 datos del taller (+ el de pruebas)
    expect(all.filter((i) => String(i.key).startsWith('overdue.'))).toHaveLength(9);
    expect(all.map((i) => i.key)).toEqual(expect.arrayContaining(['quote.defaultTaxRate', 'quote.validDays', 'quote.approvalLinkDays', 'business.name', 'business.receiptTerms']));
    const tax = all.find((i) => i.key === 'quote.defaultTaxRate')!;
    expect(tax).toMatchObject({ kind: 'number', unit: '%', min: 0, max: 100, integer: false });
    const days = all.find((i) => i.key === 'overdue.EN_REPARACION')!;
    expect(days).toMatchObject({ kind: 'number', unit: 'días', min: 1, integer: true, label: 'En reparación' });
    for (const i of all) expect(['default', 'database']).toContain(i.source);
  });

  it('editar guarda el valor, lo aplica de inmediato y queda auditado', async () => {
    expect((await item('test.sample')).source).toBe('default');
    const res = await put('test.sample', 42);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ key: 'test.sample', value: '42', source: 'database', default: '5' });
    expect(await settings.getNumber('test.sample')).toBe(42); // la API la lee ya con el valor nuevo, sin esperar a la caché
    expect((await item('test.sample')).value).toBe('42');

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'SETTING_UPDATED', entityId: 'test.sample' }, orderBy: { id: 'desc' } });
    expect(log).toMatchObject({ userId: adm.id });
    expect(log.data).toMatchObject({ from: '5', to: '42', wasDefault: true });
    expect(log.ip).toBeTruthy();
  });

  it('restablecer quita el valor guardado y vuelve al del entorno; es idempotente', async () => {
    await put('test.sample', 77);
    const reset = await api('/api/config/settings/test.sample', { method: 'DELETE', auth: adm.token });
    expect(reset.json).toMatchObject({ value: '5', source: 'default' });
    expect(await prisma.settings.count({ where: { key: 'test.sample' } })).toBe(0);
    expect(await settings.getNumber('test.sample')).toBe(5);
    expect(await prisma.auditLog.count({ where: { action: 'SETTING_RESET', entityId: 'test.sample' } })).toBeGreaterThanOrEqual(1);
    const again = await api('/api/config/settings/test.sample', { method: 'DELETE', auth: adm.token });
    expect(again.status).toBe(200); // repetirlo no falla ni audita de nuevo
  });

  it('valida rango, tipo y decimales; un valor inválido no cambia nada', async () => {
    await put('test.sample', 10);
    for (const bad of ['abc', '', '  ', -1, 101, 1.5, 'NaN', null, true]) {
      const r = await put('test.sample', bad as never);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await item('test.sample')).value).toBe('10');
    // los límites son válidos; acepta números en texto
    expect((await put('test.sample', 0)).status).toBe(200);
    expect((await put('test.sample', 100)).status).toBe(200);
    expect((await put('test.sample', ' 33 ')).json.value).toBe('33');
    // IVA admite 2 decimales pero no 3
    expect(() => settings.normalize(settings.SETTING_DEFS.find((d) => d.key === 'quote.defaultTaxRate')!, 10.5)).not.toThrow();
    expect(() => settings.normalize(settings.SETTING_DEFS.find((d) => d.key === 'quote.defaultTaxRate')!, 10.555)).toThrow(/2 decimales/);
  });

  it('un parámetro que no existe da 404 (no se puede inventar claves)', async () => {
    expect((await put('no.existe', 1)).status).toBe(404);
    expect((await api('/api/config/settings/no.existe', { method: 'DELETE', auth: adm.token })).status).toBe(404);
    expect(await prisma.settings.count({ where: { key: 'no.existe' } })).toBe(0);
  });

  it('textos: se recortan, respetan el máximo y los obligatorios no pueden quedar vacíos', () => {
    const def = (k: string) => settings.SETTING_DEFS.find((d) => d.key === k)!;
    expect(settings.normalize(def('business.name'), '  Taller Pérez  ')).toBe('Taller Pérez');
    expect(() => settings.normalize(def('business.name'), '   ')).toThrow(/vacío/);
    expect(() => settings.normalize(def('business.name'), 'x'.repeat(121))).toThrow(/120/);
    expect(() => settings.normalize(def('business.receiptTerms'), '')).toThrow(/vacío/);
    expect(settings.normalize(def('business.phone'), '')).toBe(''); // el teléfono es opcional
    expect(() => settings.normalize(def('business.name'), 123 as never)).toThrow(/texto/);
  });

  it('los textos del taller se pueden editar y no se admite el carácter nulo', async () => {
    expect((await put('business.name', 'Mal\u0000Nombre')).status).toBe(400); // lo rechaza la validación general de entradas
  });

  it('con valor guardado idéntico al vigente el comportamiento no cambia; restablecer lo devuelve al entorno', async () => {
    // Se escribe el MISMO valor que ya rige para no alterar a otros tests que corren en paralelo.
    const before = await item('quote.validDays');
    expect((await put('quote.validDays', Number(before.value))).json.source).toBe('database');
    expect(await settings.getNumber('quote.validDays')).toBe(Number(before.value));
    expect((await api('/api/config/settings/quote.validDays', { method: 'DELETE', auth: adm.token })).json.source).toBe('default');
    expect((await item('quote.validDays')).value).toBe(String(env.quote.validDays));
  });

  it('prioridad: base de datos > entorno; la caché se refresca al invalidarla', async () => {
    await prisma.settings.upsert({ where: { key: 'test.sample' }, update: { value: '61' }, create: { key: 'test.sample', value: '61' } });
    settings.invalidateSettings();
    expect(await settings.getNumber('test.sample')).toBe(61);
    await prisma.settings.deleteMany({ where: { key: 'test.sample' } });
    settings.invalidateSettings();
    expect(await settings.getNumber('test.sample')).toBe(5);
  });
});

describe('los parámetros se aplican de verdad', () => {
  it('umbrales de atraso: leen los de la configuración y se pueden sustituir', async () => {
    const t = await settings.overdueThresholds();
    expect(Object.keys(t)).toHaveLength(9);
    expect(t).toMatchObject(Object.fromEntries(Object.entries(env.overdueDays)));

    // Una reparación lleva 2 días en reparación: con el umbral por defecto (5) no está atrasada; con 1 sí.
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente Umbral', email: uniq('umb') } });
    const tool = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
    const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: tool.json.id, declaredFault: 'f', visualState: 'v' } });
    await prisma.repair.update({ where: { id: r.json.id }, data: { status: 'EN_REPARACION' } });
    await prisma.repairStatusHistory.updateMany({ where: { repairId: r.json.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    const scope = { customerId: c.json.id as number };
    expect((await dashboard(scope, { ...t })).counts.overdue).toBe(0);
    const tight = await dashboard(scope, { ...t, EN_REPARACION: 1 });
    expect(tight.counts.overdue).toBe(1);
    expect(tight.thresholds.EN_REPARACION).toBe(1);
  });

  it('datos del taller: el resguardo y el portal leen los de la configuración', async () => {
    const b = await settings.getBusiness();
    // Los valores pueden estar personalizados en la base de desarrollo: se comparan con lo que la configuración dice que rige.
    expect(b).toEqual({ name: await settings.getValue('business.name'), address: await settings.getValue('business.address'), phone: await settings.getValue('business.phone'), website: await settings.getValue('business.website'), receiptTerms: await settings.getValue('business.receiptTerms') });
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente Taller', email: uniq('tal') } });
    const tool = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
    const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: tool.json.id, declaredFault: 'f', visualState: 'v' } });
    const detail = await api(`/api/repairs/${r.json.id}`, { auth: rec.token });
    expect(detail.json.business).toEqual(b);
  });

  it('IVA por defecto: una línea sin IVA indicado usa el vigente', async () => {
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente IVA', email: uniq('iva') } });
    const tool = await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: 'T', brand: 'B', model: 'M' } });
    const r = await api('/api/repairs', { method: 'POST', auth: rec.token, body: { toolId: tool.json.id, declaredFault: 'f', visualState: 'v' } });
    await api(`/api/repairs/${r.json.id}/transition`, { method: 'POST', auth: tec.token, body: { to: 'EN_REVISION' } });
    const q = await api(`/api/repairs/${r.json.id}/quote`, { method: 'PUT', auth: tec.token, body: { items: [{ type: 'LABOR', description: 'x', quantity: 1, unitPrice: 100 }] } });
    expect(q.json.quote.versions[0].items[0].taxRate).toBe(Number(await settings.getValue('quote.defaultTaxRate')).toFixed(2));
    expect(q.json.defaultTaxRate).toBe(await settings.getNumber('quote.defaultTaxRate'));
  });
});

describe('referencia: estados y flujo', () => {
  it('muestra los 11 estados, los umbrales y la matriz real de transiciones', async () => {
    const w = (await api('/api/config/reference/workflow', { auth: adm.token })).json;
    expect(w.statuses).toHaveLength(11);
    expect(w.statuses.map((s: { status: string }) => s.status)[0]).toBe('RECIBIDO');
    expect(w.statuses.find((s: { status: string }) => s.status === 'EN_REPARACION')).toMatchObject({ final: false, overdueDays: expect.any(Number) });
    for (const s of ['ENTREGADO', 'CANCELADO']) expect(w.statuses.find((x: { status: string }) => x.status === s)).toMatchObject({ final: true, overdueDays: null });
    expect(w.transitions).toHaveLength(RULES.length);
    const approve = w.transitions.find((t: { to: string }) => t.to === 'PRESUPUESTO_APROBADO');
    expect(approve).toMatchObject({ internal: true, actors: ['CUSTOMER'] });
    const cancel = w.transitions.find((t: { from: string; to: string }) => t.from === 'RECIBIDO' && t.to === 'CANCELADO');
    expect(cancel).toMatchObject({ needsComment: true, actors: ['ADMIN', 'RECEPCION'] });
  });
});

describe('referencia: roles y permisos', () => {
  it('lista los roles con sus permisos y cuántos usuarios tiene cada uno', async () => {
    const r = (await api('/api/config/reference/roles', { auth: adm.token })).json;
    expect(r.roles.map((x: { name: string }) => x.name)).toEqual(['ADMIN', 'RECEPCION', 'TECNICO', 'CLIENTE']);
    const admin = r.roles.find((x: { name: string }) => x.name === 'ADMIN');
    expect(admin.permissions).toEqual(expect.arrayContaining(['settings:read', 'settings:update', 'user:create', 'audit:read']));
    expect(r.roles.find((x: { name: string }) => x.name === 'CLIENTE').permissions).toEqual([]);
    expect(r.roles.find((x: { name: string }) => x.name === 'TECNICO').permissions).not.toContain('user:read');
    expect(r.roles.every((x: { users: unknown }) => typeof x.users === 'number')).toBe(true);
    const upd = r.permissions.find((p: { code: string }) => p.code === 'settings:update');
    expect(upd.roles).toEqual(['ADMIN']);
    expect(r.permissions.find((p: { code: string }) => p.code === 'repair:read').roles).toEqual(expect.arrayContaining(['ADMIN', 'RECEPCION', 'TECNICO']));
  });
});

describe('referencia: tablas y tipos de datos reales', () => {
  it('describe columnas con tipo, nulabilidad, claves, referencias y conteo', async () => {
    const t = (await api('/api/config/reference/tables', { auth: adm.token })).json;
    const table = (n: string) => t.tables.find((x: { table: string }) => x.table === n);
    const col = (tn: string, cn: string) => table(tn).columns.find((c: { name: string }) => c.name === cn);
    for (const n of ['User', 'Customer', 'Tool', 'Repair', 'Quote', 'QuoteVersion', 'QuoteItem', 'QuoteApproval', 'RepairSparePart', 'Attachment', 'EmailLog', 'AuditLog', 'Settings']) {
      expect(table(n), n).toBeTruthy();
      expect(typeof table(n).rows).toBe('number');
    }
    expect(col('Repair', 'id')).toMatchObject({ type: 'integer', primaryKey: true, nullable: false });
    expect(col('Repair', 'status')).toMatchObject({ type: 'enum RepairStatus', nullable: false });
    expect(col('Repair', 'customerId').references).toBe('Customer.id');
    expect(col('QuoteItem', 'unitPrice').type).toBe('numeric(12,2)');
    expect(col('QuoteItem', 'taxRate').type).toBe('numeric(5,2)');
    expect(col('Tool', 'purchaseDate')).toMatchObject({ type: 'date', nullable: true });
    expect(col('User', 'email')).toMatchObject({ unique: true });
    expect(col('Settings', 'key')).toMatchObject({ primaryKey: true });
    expect(col('AuditLog', 'data').type).toBe('jsonb');
    expect(col('Repair', 'createdAt').type).toMatch(/^timestamp\(\d\)$/);
    expect(table('Role').columns.map((c: { name: string }) => c.name)).toEqual(['id', 'name']);
  });

  it('incluye los enumerados y las migraciones aplicadas, y ningún dato de las filas', async () => {
    const t = (await api('/api/config/reference/tables', { auth: adm.token })).json;
    const rs = t.enums.find((e: { name: string }) => e.name === 'RepairStatus');
    expect(rs.values).toHaveLength(11);
    expect(rs.values[0]).toBe('RECIBIDO');
    expect(t.enums.map((e: { name: string }) => e.name)).toEqual(expect.arrayContaining(['UserStatus', 'QuoteStatus', 'SparePartStatus', 'ApprovalDecision']));
    expect(t.migrations.length).toBeGreaterThanOrEqual(9);
    expect(t.migrations.some((m: { name: string; appliedAt: string | null }) => m.name.endsWith('_init') && m.appliedAt)).toBe(true);
    // solo estructura: ni contraseñas ni correos de usuarios
    const raw = JSON.stringify(t);
    expect(raw).not.toContain('$argon2');
    expect(raw).not.toContain(adm.email);
  });

  it('el tipo se muestra legible para los casos especiales', () => {
    const base = { character_maximum_length: null, numeric_precision: null, numeric_scale: null, datetime_precision: null, udt_name: '' };
    expect(ref.columnType({ ...base, data_type: 'character varying', character_maximum_length: 120 })).toBe('varchar(120)');
    expect(ref.columnType({ ...base, data_type: 'character varying' })).toBe('varchar');
    expect(ref.columnType({ ...base, data_type: 'numeric', numeric_precision: 12, numeric_scale: 2 })).toBe('numeric(12,2)');
    expect(ref.columnType({ ...base, data_type: 'timestamp without time zone', datetime_precision: 3 })).toBe('timestamp(3)');
    expect(ref.columnType({ ...base, data_type: 'USER-DEFINED', udt_name: 'RepairStatus' })).toBe('enum RepairStatus');
    expect(ref.columnType({ ...base, data_type: 'boolean' })).toBe('boolean');
  });
});

describe('referencia: tipos, marcas y modelos', () => {
  it('agrupa las variantes de escritura de un mismo valor', () => {
    const g = ref.groupVariants(['Bosch', 'bosch', 'BOSCH ', 'Makita', 'Bosch', '  ', 'bosch', 'Bosch']);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ label: 'Bosch', count: 6 });
    expect(g[0].variants).toEqual([{ value: 'Bosch', count: 3 }, { value: 'bosch', count: 2 }, { value: 'BOSCH', count: 1 }]);
    expect(g[1]).toMatchObject({ label: 'Makita', count: 1, variants: [{ value: 'Makita', count: 1 }] });
    expect(ref.groupVariants([])).toEqual([]);
    expect(ref.groupVariants(['a   b', 'A B'])[0].count).toBe(2); // espacios internos repetidos también cuentan como lo mismo
  });

  it('el catálogo real detecta las variantes y asocia cada modelo a su marca', async () => {
    const c = await api('/api/customers', { method: 'POST', auth: rec.token, body: { name: 'Cliente Catálogo', email: uniq('cat') } });
    const tag = `Zz${Date.now()}`;
    for (const [brand, model] of [[tag, 'M-1'], [tag.toLowerCase(), 'M-1'], [tag, 'M-2']]) {
      await api('/api/tools', { method: 'POST', auth: rec.token, body: { customerId: c.json.id, type: `Tipo${tag}`, brand, model } });
    }
    const cat = (await api('/api/config/reference/catalogs', { auth: adm.token })).json;
    const brand = cat.brands.find((b: { label: string }) => b.label.toLowerCase() === tag.toLowerCase());
    expect(brand.count).toBe(3);
    expect(brand.variants).toHaveLength(2); // «ZzNNN» y «zznnn»: hay que unificarlas
    expect(cat.types.find((t: { label: string }) => t.label === `Tipo${tag}`).count).toBe(3);
    const m1 = cat.models.find((m: { label: string; brand: string }) => m.label === 'M-1' && m.brand.toLowerCase() === tag.toLowerCase());
    expect(m1.count).toBe(2);
    expect(cat.totalTools).toBeGreaterThanOrEqual(3);
  });
});

describe('referencia: parámetros fijos y entorno', () => {
  it('lista los límites del código con sus valores reales y el entorno sin secretos', async () => {
    const s = (await api('/api/config/reference/system', { auth: adm.token })).json;
    const p = (name: string) => s.params.find((x: { name: string }) => x.name === name);
    expect(p('Longitud mínima de contraseña').value).toBe('10 caracteres');
    expect(p('Tamaño máximo por archivo')).toBeUndefined(); // ahora es un parámetro editable
    expect(p('Intentos totales (con reintentos en segundo plano)').value).toBe('5');
    expect(p('Sin cuerpo guardado (llevan enlace)').value).toContain('QUOTE_AVAILABLE');
    expect(new Set(s.params.map((x: { group: string }) => x.group)).size).toBeGreaterThanOrEqual(4);

    expect(s.environment).toMatchObject({ entorno: 'pruebas', urlPublica: env.frontendUrl, remitente: env.emailFrom });
    const raw = JSON.stringify(s);
    for (const secret of [env.jwtSecret, 'DATABASE_URL', 'postgresql://', 'SMTP_PASSWORD', env.smtp.password ?? '\u0001']) expect(raw).not.toContain(secret);
    expect(raw.toLowerCase()).not.toContain('password"');
  });
});

describe('parámetros de sistema', () => {
  const sys = async () => (await api('/api/config/settings?section=system', { auth: adm.token })).json as { group: string; items: { key: string }[] }[];

  it('se separan por sección: negocio en params, seguridad y numeración en system', async () => {
    const keys = (await sys()).flatMap((g) => g.items.map((i) => i.key));
    expect(keys).toEqual(expect.arrayContaining(['session.accessMinutes', 'session.refreshDays', 'link.inviteHours', 'attachments.maxMb', 'numbering.prefix', 'numbering.digits']));
    expect(keys).not.toContain('quote.validDays');
    const params = ((await api('/api/config/settings?section=params', { auth: adm.token })).json as { items: { key: string }[] }[]).flatMap((g) => g.items.map((i) => i.key));
    expect(params).toContain('business.website');
    expect(params).not.toContain('session.refreshDays');
  });

  it('validan rangos y el prefijo de numeración (solo mayúsculas y números)', async () => {
    for (const [k, v] of [['session.accessMinutes', 1], ['session.accessMinutes', 500], ['session.refreshDays', 0], ['attachments.maxMb', 999], ['numbering.digits', 2], ['numbering.prefix', 'rep'], ['numbering.prefix', 'RE P'], ['numbering.prefix', 'ABCDEFGHIJK'], ['numbering.prefix', '']] as const) {
      expect((await put(k, v)).status, `${k}=${v}`).toBe(400);
    }
  });

  it('el valor por defecto reproduce el comportamiento anterior', async () => {
    expect(await settings.getNumber('session.accessMinutes')).toBe(15);
    expect(await settings.getNumber('session.refreshDays')).toBe(7);
    expect(await settings.getValue('numbering.prefix')).toBe('REP');
    expect(await settings.getNumber('numbering.digits')).toBe(6);
  });
});

describe('nombre del taller público', () => {
  it('lo ven las cabeceras sin iniciar sesión, y solo trae el nombre', async () => {
    const r = await api('/api/business');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ name: await settings.getValue('business.name') });
  });
});
