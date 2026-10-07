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
  refreshSecret: required('REFRESH_SECRET'),
  frontendUrl: required('FRONTEND_URL'),
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    user: process.env.SMTP_USER || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
  },
  emailFrom: required('EMAIL_FROM'),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
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
    RECIBIDO: 3, EN_REVISION: 3, PRESUPUESTO_PENDIENTE_APROBACION: 7, PRESUPUESTO_APROBADO: 3, PRESUPUESTO_RECHAZADO: 7,
    PEDIDO_REPUESTOS_MARCA: 7, EN_REPARACION: 5, REPARADO: 3, LISTO_PARA_RETIRAR: 7,
  };
  for (const pair of (process.env.OVERDUE_DAYS ?? '').split(',')) {
    const [k, v] = pair.split('=').map((x) => x.trim());
    if (k in d && Number(v) > 0) d[k] = Number(v);
  }
  return d;
}
