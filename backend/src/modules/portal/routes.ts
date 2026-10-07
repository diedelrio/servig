import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../lib/http.js';
import { limit } from '../../lib/rateLimit.js';
import { requireAuth, requireCustomer } from '../../middleware/auth.js';
import * as s from './service.js';

export const portalRouter = Router();
portalRouter.use(requireAuth, requireCustomer);

const id = (v: unknown) => Number(v);

portalRouter.get('/repairs', async (req, res) => {
  res.json(await s.listRepairs(req.customerId!));
});

portalRouter.get('/repairs/:id', async (req, res) => {
  res.json(await s.getRepair(req.customerId!, id(req.params.id)));
});

portalRouter.get('/repairs/:id/attachments/:attId', async (req, res) => {
  const { meta, stream } = await s.getAttachment(req.customerId!, id(req.params.id), id(req.params.attId));
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('Content-Length', meta.size);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  stream.pipe(res);
});

const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(1000).optional() });

portalRouter.post('/repairs/:id/quote/decision', limit(30, 15), validate(decisionSchema), async (req, res) => {
  const r = await s.decide(req.customerId!, req.user!.id, id(req.params.id), req.body.decision, {
    comment: req.body.comment, ip: req.ip, userAgent: req.get('user-agent'),
  });
  res.json({ message: req.body.decision === 'APPROVE' ? 'Presupuesto aprobado' : 'Presupuesto rechazado', ...r });
});
