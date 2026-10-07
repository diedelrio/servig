import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { MAX_ATTEMPTS, SENSITIVE_TYPES } from '../../lib/email.js';
import { RULES } from '../repairs/workflow.js';

import { PASSWORD_MIN } from '../auth/schemas.js';
import { overdueThresholds } from '../../lib/settings.js';

/** Datos de referencia de solo lectura para la pantalla de configuración del administrador. */

// ---------- Estados y flujo ----------

const REPAIR_STATUS_ORDER = [
  'SOLICITADA', 'RECIBIDO', 'EN_REVISION', 'PRESUPUESTO_PENDIENTE_APROBACION', 'PRESUPUESTO_APROBADO', 'PRESUPUESTO_RECHAZADO',
  'PEDIDO_REPUESTOS_MARCA', 'EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR', 'ENTREGADO', 'CANCELADO',
];

export async function workflowRef() {
  const thresholds = await overdueThresholds();
  return {
    statuses: REPAIR_STATUS_ORDER.map((s) => ({
      status: s,
      final: s === 'ENTREGADO' || s === 'CANCELADO',
      overdueDays: thresholds[s] ?? null,
    })),
    // La matriz real que aplica el servidor (workflow.ts): nada de esto está duplicado a mano.
    transitions: RULES.map((r) => ({
      from: r.from, to: r.to, label: r.label, actors: r.actors,
      internal: !!r.internal, needsComment: !!r.needsComment, onlyIfNoQuote: !!r.onlyIfNoQuote, parts: r.parts ?? null,
    })),
  };
}

// ---------- Roles y permisos ----------

export async function rolesRef() {
  const roles = await prisma.role.findMany({
    orderBy: { id: 'asc' },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  });
  const permissions = await prisma.permission.findMany({ orderBy: { code: 'asc' } });
  return {
    roles: roles.map((r) => ({
      id: r.id, name: r.name, users: r._count.users, permissions: r.permissions.map((p) => p.permission.code).sort(),
    })),
    permissions: permissions.map((p) => ({ code: p.code, roles: roles.filter((r) => r.permissions.some((rp) => rp.permissionId === p.id)).map((r) => r.name) })),
  };
}

// ---------- Tablas y tipos de datos (leídos de la base real) ----------

type ColRow = {
  table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null;
  character_maximum_length: number | null; numeric_precision: number | null; numeric_scale: number | null; datetime_precision: number | null;
};

/** Texto legible del tipo: varchar(120), numeric(12,2), timestamp(3), enum RepairStatus… */
export function columnType(c: Pick<ColRow, 'data_type' | 'udt_name' | 'character_maximum_length' | 'numeric_precision' | 'numeric_scale' | 'datetime_precision'>) {
  switch (c.data_type) {
    case 'character varying': return c.character_maximum_length ? `varchar(${c.character_maximum_length})` : 'varchar';
    case 'numeric': return c.numeric_precision ? `numeric(${c.numeric_precision},${c.numeric_scale ?? 0})` : 'numeric';
    case 'timestamp without time zone': return `timestamp(${c.datetime_precision ?? 6})`;
    case 'timestamp with time zone': return `timestamptz(${c.datetime_precision ?? 6})`;
    case 'USER-DEFINED': return `enum ${c.udt_name}`;
    default: return c.data_type;
  }
}

const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function tablesRef() {
  const cols = await prisma.$queryRaw<ColRow[]>`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
           c.character_maximum_length, c.numeric_precision, c.numeric_scale, c.datetime_precision
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position`;
  const cons = await prisma.$queryRaw<{ table_name: string; column_name: string; constraint_type: string; ref_table: string | null; ref_column: string | null }[]>`
    SELECT tc.table_name, kcu.column_name, tc.constraint_type, ccu.table_name AS ref_table, ccu.column_name AS ref_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    LEFT JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema AND tc.constraint_type = 'FOREIGN KEY'
    WHERE tc.table_schema = 'public' AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')`;
  // Prisma crea los @unique como índices únicos, no como constraints.
  const uniques = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT t.relname AS table_name, a.attname AS column_name
    FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
    WHERE n.nspname = 'public' AND i.indisunique AND NOT i.indisprimary AND i.indnatts = 1`;
  const enums = await prisma.$queryRaw<{ typname: string; enumlabel: string }[]>`
    SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid ORDER BY t.typname, e.enumsortorder`;
  const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
    SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at`;

  const names = [...new Set(cols.map((c) => c.table_name))].filter((n) => SAFE_NAME.test(n));
  // Conteo exacto por tabla: los nombres salen del catálogo de la base y se validan, no vienen del usuario.
  const counts = await Promise.all(names.map(async (n) => [n, Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${n}"`))[0].n)] as const));
  const countOf = new Map(counts);

  return {
    tables: names.map((table) => ({
      table,
      rows: countOf.get(table) ?? 0,
      columns: cols.filter((c) => c.table_name === table).map((c) => ({
        name: c.column_name,
        type: columnType(c),
        nullable: c.is_nullable === 'YES',
        default: c.column_default,
        primaryKey: cons.some((k) => k.table_name === table && k.column_name === c.column_name && k.constraint_type === 'PRIMARY KEY'),
        unique: uniques.some((k) => k.table_name === table && k.column_name === c.column_name),
        references: cons.find((k) => k.table_name === table && k.column_name === c.column_name && k.constraint_type === 'FOREIGN KEY')
          ? `${cons.find((k) => k.table_name === table && k.column_name === c.column_name && k.constraint_type === 'FOREIGN KEY')!.ref_table}.${cons.find((k) => k.table_name === table && k.column_name === c.column_name && k.constraint_type === 'FOREIGN KEY')!.ref_column}`
          : null,
      })),
    })),
    enums: [...new Set(enums.map((e) => e.typname))].map((name) => ({ name, values: enums.filter((e) => e.typname === name).map((e) => e.enumlabel) })),
    migrations: migrations.map((m) => ({ name: m.migration_name, appliedAt: m.finished_at })),
  };
}

// ---------- Catálogos derivados de lo ya registrado (tipos, marcas, modelos) ----------

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export type VariantGroup = { label: string; count: number; variants: { value: string; count: number }[] };

/**
 * Agrupa textos libres que son el mismo valor escrito distinto («Bosch», «bosch», «BOSCH »). El nombre mostrado es la variante
 * más usada; si hay más de una, el grupo trae las variantes para poder unificarlas a mano.
 */
export function groupVariants(values: string[]): VariantGroup[] {
  const groups = new Map<string, Map<string, number>>();
  for (const v of values) {
    const k = norm(v);
    if (!k) continue;
    const g = groups.get(k) ?? new Map<string, number>();
    const shown = v.trim().replace(/\s+/g, ' ');
    g.set(shown, (g.get(shown) ?? 0) + 1);
    groups.set(k, g);
  }
  return [...groups.values()]
    .map((g) => {
      const variants = [...g.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      return { label: variants[0].value, count: variants.reduce((a, v) => a + v.count, 0), variants };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function catalogsRef() {
  const tools = await prisma.tool.findMany({ select: { type: true, brand: true, model: true } });
  const brandGroups = groupVariants(tools.map((t) => t.brand));
  return {
    totalTools: tools.length,
    types: groupVariants(tools.map((t) => t.type)),
    brands: brandGroups,
    // Un modelo se identifica junto a su marca (el mismo nombre de modelo puede existir en marcas distintas).
    models: groupVariants(tools.map((t) => `${norm(t.brand)}\u0000${t.model}`)).map((g) => ({
      label: g.label.split('\u0000')[1],
      brand: brandGroups.find((b) => norm(b.label) === g.label.split('\u0000')[0])?.label ?? g.label.split('\u0000')[0],
      count: g.count,
      variants: g.variants.map((v) => ({ value: v.value.split('\u0000')[1], count: v.count })),
    })),
  };
}

// ---------- Parámetros fijos del sistema (viven en el código) y entorno ----------

export type SystemParam = { group: string; name: string; value: string; note?: string };

/** Documentación viva de lo que NO se edita desde la pantalla: para cambiarlo hay que modificar el código y desplegar. */
export function systemRef(): SystemParam[] {
  return [
    { group: 'Contraseñas y sesión', name: 'Longitud mínima de contraseña', value: `${PASSWORD_MIN} caracteres`, note: 'Debe incluir una letra y un número; se rechazan las más comunes. Hash Argon2id.' },
    { group: 'Contraseñas y sesión', name: 'Tolerancia ante dos pestañas', value: '10 segundos' },
    { group: 'Enlaces de un solo uso', name: 'Espera entre reenvíos', value: '60 segundos' },
    { group: 'Correos', name: 'Intentos inmediatos al enviar', value: '3', note: 'Esperas de 1 s y 3 s.' },
    { group: 'Correos', name: 'Intentos totales (con reintentos en segundo plano)', value: String(MAX_ATTEMPTS), note: 'Espera inicial 5 min, creciente.' },
    { group: 'Correos', name: 'Sin cuerpo guardado (llevan enlace)', value: [...SENSITIVE_TYPES].join(', ') },
    { group: 'Adjuntos', name: 'Formatos permitidos', value: 'JPG, PNG, WebP, PDF', note: 'Se validan por el contenido real del archivo.' },
    { group: 'Límites de uso', name: 'Inicio de sesión', value: '20 por IP y 10 por cuenta cada 15 min', note: 'Los accesos correctos no cuentan.' },
    { group: 'Límites de uso', name: 'Registro, reenvío y recuperación', value: '10 por hora y IP' },
    { group: 'Límites de uso', name: 'Verificación de email / refresco de sesión', value: '20 / 120 cada 15 min por IP' },
    { group: 'Límites de uso', name: 'Enlace público de aprobación', value: '60 cada 15 min por IP' },
    { group: 'Límites de uso', name: 'Decisión desde el portal', value: '30 cada 15 min por IP' },
    { group: 'Límites de uso', name: 'API en general', value: '600 por minuto y IP' },
    { group: 'Presupuestos y repuestos', name: 'Líneas por presupuesto', value: 'hasta 100' },
    { group: 'Presupuestos y repuestos', name: 'Cantidad y precio por línea', value: 'cantidad ≤ 9.999 · precio ≤ 999.999,99', note: 'Importes con 2 decimales y total máximo 9.999.999.999,99.' },
    { group: 'Presupuestos y repuestos', name: 'Estados del presupuesto', value: 'Borrador, Enviado, Aprobado, Rechazado, Vencido, Cancelado' },
    { group: 'Procesos periódicos', name: 'Vencimiento de presupuestos', value: 'cada hora' },
    { group: 'Procesos periódicos', name: 'Reintento de correos fallidos', value: 'cada 5 minutos' },
  ];
}

/** Entorno de ejecución, sin secretos (nunca contraseñas ni la cadena de la base de datos). */
export function environmentRef() {
  return {
    entorno: env.isProd ? 'producción' : env.isTest ? 'pruebas' : 'desarrollo',
    puerto: env.port,
    urlPublica: env.frontendUrl,
    remitente: env.emailFrom,
    servidorCorreo: `${env.smtp.host}:${env.smtp.port}`,
    correoConAutenticacion: !!env.smtp.user,
    carpetaAdjuntos: env.uploadDir,
    proxysDeConfianza: env.trustProxy === false ? 0 : env.trustProxy,
  };
}
