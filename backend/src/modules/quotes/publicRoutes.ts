import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../lib/http.js';
import { limit } from '../../lib/rateLimit.js';
import * as approval from './approval.js';

// Sin sesión: el token del enlace es la credencial. Límite por IP para frenar adivinación y abuso.
export const publicQuoteRouter = Router();
publicQuoteRouter.use(limit(60, 15));

const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(1000).optional(),
});

publicQuoteRouter.get('/:token', async (req, res) => {
  res.json(await approval.viewByLink(String(req.params.token)));
});

publicQuoteRouter.post('/:token/decision', validate(decisionSchema), async (req, res) => {
  const r = await approval.decideByLink(String(req.params.token), req.body.decision, {
    comment: req.body.comment,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.json({ message: req.body.decision === 'APPROVE' ? 'Presupuesto aprobado' : 'Presupuesto rechazado', ...r });
});
