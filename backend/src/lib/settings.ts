import { audit } from './audit.js';
import { env } from './env.js';
import { HttpError } from './http.js';
import { prisma } from './prisma.js';

/**
 * Parámetros editables desde el portal de administración. Orden de prioridad: base de datos → variable de entorno → valor
 * por defecto del código. El valor «por defecto» de cada definición ya incluye la variable de entorno, así que quitar el
 * valor guardado (restablecer) vuelve a lo que diga el entorno. Se guardan en la tabla Settings (clave y valor en texto).
 */
export type SettingDef = {
  key: string;
  group: string;
  label: string;
  description: string;
  kind: 'number' | 'text';
  unit?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  maxLength?: number;
  required?: boolean;
  /** Expresión que debe cumplir un texto (con `patternHint` como mensaje). */
  pattern?: RegExp;
  patternHint?: string;
  /** Pantalla donde se edita: «params» (negocio) o «system» (seguridad y funcionamiento). */
  section: 'params' | 'system';
  default: string;
};

const STATUS_ES: Record<string, string> = {
  RECIBIDO: 'Recibido', EN_REVISION: 'En revisión', PRESUPUESTO_PENDIENTE_APROBACION: 'Presupuesto pendiente de aprobación',
  PRESUPUESTO_APROBADO: 'Presupuesto aprobado', PRESUPUESTO_RECHAZADO: 'Presupuesto rechazado', PEDIDO_REPUESTOS_MARCA: 'Repuestos pedidos a la marca',
  EN_REPARACION: 'En reparación', REPARADO: 'Reparado', LISTO_PARA_RETIRAR: 'Listo para retirar',
};

export const SETTING_DEFS: SettingDef[] = [
  {
    section: 'params', key: 'quote.defaultTaxRate', group: 'Presupuestos', label: 'IVA por defecto', kind: 'number', unit: '%', min: 0, max: 100,
    description: 'IVA que se propone en cada línea nueva de un presupuesto (se puede cambiar línea a línea).', default: String(env.quote.defaultTaxRate),
  },
  {
    section: 'params', key: 'quote.validDays', group: 'Presupuestos', label: 'Validez del presupuesto', kind: 'number', unit: 'días', min: 1, max: 365, integer: true,
    description: 'Días que un presupuesto enviado puede aprobarse; pasado ese plazo pasa a «Vencido». Afecta a los presupuestos que se envíen desde ahora.', default: String(env.quote.validDays),
  },
  {
    section: 'params', key: 'quote.approvalLinkDays', group: 'Presupuestos', label: 'Vigencia del enlace de aprobación', kind: 'number', unit: 'días', min: 1, max: 90, integer: true,
    description: 'Días que dura el enlace del correo para aprobar o rechazar (nunca más que la validez del presupuesto). Si vence, el taller puede reenviar uno nuevo.', default: String(env.quote.approvalLinkDays),
  },
  ...Object.entries(env.overdueDays).map(([status, days]): SettingDef => ({
    section: 'params', key: `overdue.${status}`, group: 'Atrasos', label: STATUS_ES[status] ?? status, kind: 'number', unit: 'días', min: 1, max: 365, integer: true,
    description: 'Días máximos en este estado antes de considerar la reparación atrasada (se cuentan desde el último cambio de estado).', default: String(days),
  })),
  { section: 'params', key: 'business.name', group: 'Datos del taller', label: 'Nombre del taller', kind: 'text', maxLength: 120, required: true, description: 'Aparece en el resguardo, en el presupuesto y en el portal del cliente.', default: env.business.name },
  { section: 'params', key: 'business.address', group: 'Datos del taller', label: 'Dirección', kind: 'text', maxLength: 250, description: 'Se imprime en el resguardo y en el presupuesto.', default: env.business.address },
  { section: 'params', key: 'business.website', group: 'Datos del taller', label: 'Página web', kind: 'text', maxLength: 200, description: 'Se imprime en el resguardo y en el presupuesto.', default: '' },
  { section: 'params', key: 'business.phone', group: 'Datos del taller', label: 'Teléfono', kind: 'text', maxLength: 40, description: 'Se imprime en el resguardo y se muestra al cliente.', default: env.business.phone },
  {
    section: 'params', key: 'business.receiptTerms', group: 'Datos del taller', label: 'Texto del resguardo', kind: 'text', maxLength: 1000, required: true,
    description: 'Condiciones que se imprimen al pie del resguardo de recepción.', default: env.business.receiptTerms,
  },
  // ---- Sistema: sesiones, enlaces, adjuntos y numeración ----
  { section: 'system', key: 'session.accessMinutes', group: 'Sesión', label: 'Duración del acceso (token JWT)', kind: 'number', unit: 'minutos', min: 5, max: 120, integer: true, description: 'Tiempo que vale cada token de acceso; luego se renueva solo con la sesión. Más corto es más seguro. Rige en los tokens que se emitan desde ahora.', default: '15' },
  { section: 'system', key: 'session.refreshDays', group: 'Sesión', label: 'Duración de la sesión', kind: 'number', unit: 'días', min: 1, max: 90, integer: true, description: 'Días sin volver a iniciar sesión. Rige en las sesiones que se inicien desde ahora.', default: '7' },
  { section: 'system', key: 'link.verifyEmailHours', group: 'Enlaces de un solo uso', label: 'Confirmación de email', kind: 'number', unit: 'horas', min: 1, max: 168, integer: true, description: 'Vigencia del enlace de confirmación de correo.', default: '24' },
  { section: 'system', key: 'link.resetPasswordMinutes', group: 'Enlaces de un solo uso', label: 'Recuperación de contraseña', kind: 'number', unit: 'minutos', min: 10, max: 1440, integer: true, description: 'Vigencia del enlace para restablecer la contraseña.', default: '60' },
  { section: 'system', key: 'link.inviteHours', group: 'Enlaces de un solo uso', label: 'Invitación de personal', kind: 'number', unit: 'horas', min: 1, max: 336, integer: true, description: 'Vigencia del enlace con el que una persona nueva del taller define su contraseña.', default: '72' },
  { section: 'system', key: 'attachments.maxMb', group: 'Adjuntos', label: 'Tamaño máximo por archivo', kind: 'number', unit: 'MB', min: 1, max: 50, integer: true, description: 'Fotos y PDF de una reparación.', default: '10' },
  { section: 'system', key: 'attachments.maxPerRepair', group: 'Adjuntos', label: 'Máximo de adjuntos por reparación', kind: 'number', unit: 'archivos', min: 1, max: 200, integer: true, description: 'Al llegar al máximo no se aceptan más.', default: '30' },
  { section: 'system', key: 'numbering.prefix', group: 'Numeración del resguardo', label: 'Prefijo del número', kind: 'text', maxLength: 10, required: true, pattern: /^[A-Z0-9]+$/, patternHint: 'solo letras mayúsculas y números, sin espacios', description: 'Formato final: PREFIJO-AAAA-NNNNNN. Los números ya emitidos no cambian; el contador anual del nuevo prefijo empieza en 1.', default: 'REP' },
  { section: 'system', key: 'numbering.digits', group: 'Numeración del resguardo', label: 'Cifras del correlativo', kind: 'number', unit: 'cifras', min: 3, max: 10, integer: true, description: 'Relleno con ceros a la izquierda (6 → 000123). Si el correlativo supera las cifras, simplemente se alarga.', default: '6' },
  // Solo en pruebas: permite probar la edición sin tocar parámetros reales que leen otros procesos en paralelo.
  ...(env.isTest
    ? [{ section: 'params' as const, key: 'test.sample', group: 'Pruebas', label: 'Parámetro de prueba', kind: 'number' as const, unit: 'u', min: 0, max: 100, integer: true, description: 'Solo existe en tests.', default: '5' }]
    : []),
];

const byKey = new Map(SETTING_DEFS.map((d) => [d.key, d]));
const TTL_MS = 10_000; // los valores se releen de la base como mucho cada 10 s (y al instante tras una edición propia)

let cache: { at: number; rows: Map<string, string> } | null = null;
export const invalidateSettings = () => {
  cache = null;
};

async function rows() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const found = await prisma.settings.findMany({ where: { key: { in: SETTING_DEFS.map((d) => d.key) } } });
  cache = { at: Date.now(), rows: new Map(found.map((r) => [r.key, r.value])) };
  return cache.rows;
}

function def(key: string) {
  const d = byKey.get(key);
  if (!d) throw new HttpError(404, 'Parámetro desconocido', 'UNKNOWN_SETTING');
  return d;
}

export async function getValue(key: string): Promise<string> {
  return (await rows()).get(key) ?? def(key).default;
}
export async function getNumber(key: string): Promise<number> {
  return Number(await getValue(key));
}

export async function quoteConfig() {
  const [defaultTaxRate, validDays, approvalLinkDays] = await Promise.all([
    getNumber('quote.defaultTaxRate'), getNumber('quote.validDays'), getNumber('quote.approvalLinkDays'),
  ]);
  return { defaultTaxRate, validDays, approvalLinkDays };
}

export async function overdueThresholds(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const d of SETTING_DEFS) if (d.key.startsWith('overdue.')) out[d.key.slice('overdue.'.length)] = await getNumber(d.key);
  return out;
}

export async function getBusiness() {
  const [name, address, phone, website, receiptTerms] = await Promise.all(['business.name', 'business.address', 'business.phone', 'business.website', 'business.receiptTerms'].map(getValue));
  return { name, address, phone, website, receiptTerms };
}

/** Valida y normaliza el valor recibido según la definición; lanza 400 con un mensaje claro si no es válido. */
export function normalize(d: SettingDef, raw: unknown): string {
  if (d.kind === 'text') {
    if (typeof raw !== 'string') throw new HttpError(400, 'El valor debe ser un texto', 'INVALID_SETTING');
    const v = raw.trim();
    if (d.required && !v) throw new HttpError(400, `«${d.label}» no puede quedar vacío`, 'INVALID_SETTING');
    if (v && d.pattern && !d.pattern.test(v)) throw new HttpError(400, `«${d.label}»: ${d.patternHint ?? 'formato no válido'}`, 'INVALID_SETTING');
    if (d.maxLength && v.length > d.maxLength) throw new HttpError(400, `«${d.label}» admite como máximo ${d.maxLength} caracteres`, 'INVALID_SETTING');
    return v;
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) throw new HttpError(400, `«${d.label}» debe ser un número`, 'INVALID_SETTING');
  if (d.integer && !Number.isInteger(n)) throw new HttpError(400, `«${d.label}» debe ser un número entero`, 'INVALID_SETTING');
  if (!d.integer && Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw new HttpError(400, `«${d.label}» admite como máximo 2 decimales`, 'INVALID_SETTING');
  if (d.min !== undefined && n < d.min) throw new HttpError(400, `«${d.label}» debe ser como mínimo ${d.min}`, 'INVALID_SETTING');
  if (d.max !== undefined && n > d.max) throw new HttpError(400, `«${d.label}» debe ser como máximo ${d.max}`, 'INVALID_SETTING');
  return String(n);
}

const view = (d: SettingDef, stored: string | undefined) => ({
  key: d.key, label: d.label, description: d.description, kind: d.kind, unit: d.unit ?? null,
  min: d.min ?? null, max: d.max ?? null, integer: !!d.integer, maxLength: d.maxLength ?? null, required: !!d.required,
  section: d.section, default: d.default, value: stored ?? d.default, source: stored === undefined ? ('default' as const) : ('database' as const),
});

/** Todos los parámetros agrupados, con su valor efectivo y de dónde viene. */
export async function listSettings(section?: 'params' | 'system') {
  invalidateSettings(); // la pantalla siempre muestra lo último guardado
  const r = await rows();
  const groups: { group: string; items: ReturnType<typeof view>[] }[] = [];
  for (const d of SETTING_DEFS) {
    if (section && d.section !== section) continue;
    let g = groups.find((x) => x.group === d.group);
    if (!g) groups.push((g = { group: d.group, items: [] }));
    g.items.push(view(d, r.get(d.key)));
  }
  return groups;
}

export async function updateSetting(userId: number, key: string, raw: unknown) {
  const d = def(key);
  const value = normalize(d, raw);
  invalidateSettings();
  const before = (await rows()).get(key);
  await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } });
  invalidateSettings();
  await audit('SETTING_UPDATED', 'Settings', key, userId, { from: before ?? d.default, to: value, wasDefault: before === undefined });
  return view(d, value);
}

/** Quita el valor guardado: el parámetro vuelve al del entorno / valor por defecto. */
export async function resetSetting(userId: number, key: string) {
  const d = def(key);
  invalidateSettings();
  const before = (await rows()).get(key);
  await prisma.settings.deleteMany({ where: { key } });
  invalidateSettings();
  if (before !== undefined) await audit('SETTING_RESET', 'Settings', key, userId, { from: before, to: d.default });
  return view(d, undefined);
}
