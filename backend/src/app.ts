import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { HttpError } from './lib/http.js';
import { authRouter } from './modules/auth/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { customersRouter, toolsRouter } from './modules/customers/routes.js';
import { repairsRouter } from './modules/repairs/routes.js';
import { quotesRouter } from './modules/quotes/routes.js';
import { publicQuoteRouter } from './modules/quotes/publicRoutes.js';
import { partsRouter, repairPartsRouter } from './modules/spareparts/routes.js';

export const app = express();

app.set('trust proxy', env.trustProxy);
app.use(helmet());
app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/customers', customersRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/repairs', repairsRouter);
app.use('/api/repairs', quotesRouter);
app.use('/api/repairs', repairPartsRouter);
app.use('/api/spare-parts', partsRouter);
app.use('/api/public/quote-approval', publicQuoteRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    const { details } = err as HttpError & { details?: unknown };
    return res.status(err.status).json({ error: err.message, code: err.code, details });
  }
  // Errores del parser de cuerpo (JSON mal formado, cuerpo demasiado grande).
  const status = (err as { status?: number }).status;
  if (status === 413) return res.status(413).json({ error: 'El archivo supera el máximo de 10 MB' });
  if (status === 400) return res.status(400).json({ error: 'Petición mal formada' });
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});
