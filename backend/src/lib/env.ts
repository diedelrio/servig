import 'dotenv/config';

const required = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Falta variable de entorno ${k}`);
  return v;
};

export const env = {
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: required('JWT_SECRET'),
  frontendUrl: required('FRONTEND_URL'),
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    user: process.env.SMTP_USER || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
  },
  emailFrom: required('EMAIL_FROM'),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  /** Frontend compilado que la propia API sirve (imagen de producción). Si la carpeta no existe, no se sirve nada. */
  staticDir: process.env.STATIC_DIR ?? './public',
  quote: {
    defaultTaxRate: Number(process.env.DEFAULT_TAX_RATE ?? 21),
    validDays: Number(process.env.QUOTE_VALID_DAYS ?? 15),
    approvalLinkDays: Number(process.env.APPROVAL_LINK_DAYS ?? 7),
  },
  // Días máximos en cada estado antes de considerar la reparación atrasada. Se pisan con OVERDUE_DAYS="RECIBIDO=2,EN_REPARACION=10".
  overdueDays: overdueDays(),
  // Nº de proxys de confianza delante de la API (para registrar la IP real del cliente).
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  business: {
    name: process.env.BUSINESS_NAME ?? 'Servig',
    address: process.env.BUSINESS_ADDRESS ?? '',
    phone: process.env.BUSINESS_PHONE ?? '',
    receiptTerms:
      process.env.RECEIPT_TERMS ??
      'Conserve este resguardo: es necesario para retirar la herramienta. No se iniciará ninguna reparación que requiera presupuesto sin su aprobación expresa.',
  },
};

function overdueDays(): Record<string, number> {
  const d: Record<string, number> = {
    SOLICITADA: 7, RECIBIDO: 3, EN_REVISION: 3, PRESUPUESTO_PENDIENTE_APROBACION: 7, PRESUPUESTO_APROBADO: 3, PRESUPUESTO_RECHAZADO: 7,
    PEDIDO_REPUESTOS_MARCA: 7, EN_REPARACION: 5, REPARADO: 3, LISTO_PARA_RETIRAR: 7,
  };
  for (const pair of (process.env.OVERDUE_DAYS ?? '').split(',')) {
    const [k, v] = pair.split('=').map((x) => x.trim());
    if (k in d && Number(v) > 0) d[k] = Number(v);
  }
  return d;
}

/**
 * En producción se arranca solo si la configuración es segura; es mejor no arrancar que arrancar con un secreto de ejemplo.
 * Devuelve los problemas encontrados (vacío = todo bien).
 */
export function productionProblems(v: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  const secret = v.JWT_SECRET ?? '';
  if (secret.length < 32) problems.push('JWT_SECRET debe tener al menos 32 caracteres');
  if (/^change-?me/i.test(secret)) problems.push('JWT_SECRET sigue siendo el valor de ejemplo');
  if (!/^https:\/\//.test(v.FRONTEND_URL ?? '')) problems.push('FRONTEND_URL debe ser una URL https:// (los enlaces de los correos y las cookies seguras lo exigen)');
  // Sin esto, tras un balanceador toda petición parece venir de la misma IP: el límite de intentos sería global y la IP auditada, falsa.
  if (v.TRUST_PROXY === undefined || v.TRUST_PROXY === '') problems.push('TRUST_PROXY debe indicarse explícitamente (0 si no hay proxy delante; 1 detrás de un balanceador)');
  else if (!/^\d+$/.test(v.TRUST_PROXY)) problems.push('TRUST_PROXY debe ser un número entero (nº de proxys de confianza)');
  if (!v.SMTP_HOST || ['localhost', '127.0.0.1'].includes(v.SMTP_HOST)) problems.push('SMTP_HOST apunta a la máquina local: configura un proveedor de correo real');
  return problems;
}

if (process.env.NODE_ENV === 'production') {
  const problems = productionProblems(process.env);
  if (problems.length) throw new Error('Configuración de producción insegura:\n - ' + problems.join('\n - '));
}
