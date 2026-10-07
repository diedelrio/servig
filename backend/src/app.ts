import express from 'express';
import { getBusiness } from './lib/settings.js';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { access, constants, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { HttpError, rejectNul } from './lib/http.js';
import { limit } from './lib/rateLimit.js';
import { requestContext } from './lib/requestContext.js';
import { authRouter } from './modules/auth/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { customersRouter, toolsRouter } from './modules/customers/routes.js';
import { repairsRouter } from './modules/repairs/routes.js';
import { quotesRouter } from './modules/quotes/routes.js';
import { publicQuoteRouter } from './modules/quotes/publicRoutes.js';
import { partsRouter, repairPartsRouter } from './modules/spareparts/routes.js';
import { portalRouter } from './modules/portal/routes.js';
import { auditRouter, emailLogsRouter } from './modules/admin/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { configRouter } from './modules/config/routes.js';
import { catalogsRouter } from './modules/catalogs/routes.js';

export const app = express();

app.set('trust proxy', env.trustProxy);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // La app no necesita nada de terceros. blob: para mostrar las fotos descargadas con el token; nadie puede incrustarla en un iframe.
        'img-src': ["'self'", 'data:', 'blob:'],
        'frame-ancestors': ["'none'"],
      },
    },
  }),
);
app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(rejectNul);
app.use(requestContext);

// Comprobación para el balanceador/PaaS: la base responde Y la carpeta de adjuntos existe y se puede escribir
// (si el volumen persistente no está montado, aquí se nota en vez de perder fotos en silencio).
// Nombre del taller: lo muestran las cabeceras y las pantallas de acceso (no es un dato sensible).
app.get('/api/business', async (_req, res) => {
  res.json({ name: (await getBusiness()).name });
});
app.get('/api/health', async (_req, res) => {
  const checks = { db: false, storage: false };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch { /* se informa abajo */ }
  try {
    await mkdir(resolve(env.uploadDir), { recursive: true });
    await access(resolve(env.uploadDir), constants.W_OK);
    checks.storage = true;
  } catch { /* se informa abajo */ }
  const ok = checks.db && checks.storage;
  res.status(ok ? 200 : 503).json({ ok, ...checks });
});

// Tope general por IP contra inundaciones; los endpoints sensibles tienen además el suyo.
app.use('/api', limit(600, 1));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/customers', customersRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/repairs', repairsRouter);
app.use('/api/repairs', quotesRouter);
app.use('/api/repairs', repairPartsRouter);
app.use('/api/spare-parts', partsRouter);
app.use('/api/portal', portalRouter);
app.use('/api', dashboardRouter);
app.use('/api/audit', auditRouter);
app.use('/api/config', configRouter);
app.use('/api/catalogs', catalogsRouter);
app.use('/api/email-logs', emailLogsRouter);
app.use('/api/public/quote-approval', publicQuoteRouter);

// Una ruta de API inexistente es un 404 en JSON, nunca la página de la aplicación.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'No encontrado' });
});

// Frontend compilado (imagen de producción): mismo origen que la API, así las cookies y el CORS no dan problemas.
const staticDir = resolve(env.staticDir);
if (existsSync(join(staticDir, 'index.html'))) {
  // Los archivos de /assets llevan hash en el nombre: se pueden cachear un año. El resto (index.html) siempre se revalida.
  app.use('/assets', express.static(join(staticDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(staticDir, { index: false, maxAge: 0 }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(staticDir, 'index.html')); // rutas del lado del cliente (React Router)
  });
}

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    const { details } = err as HttpError & { details?: unknown };
    return res.status(err.status).json({ error: err.message, code: err.code, details });
  }
  // Errores del parser de cuerpo (JSON mal formado, cuerpo demasiado grande).
  const status = (err as { status?: number }).status;
  if (status === 413) return res.status(413).json({ error: req.path.includes('/attachments') ? 'El archivo supera el máximo de 10 MB' : 'La petición es demasiado grande' });
  if (status === 400) return res.status(400).json({ error: 'Petición mal formada' });
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});
