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
};
