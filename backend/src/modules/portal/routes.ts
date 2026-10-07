import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { validate } from '../../lib/http.js';
import { limit } from '../../lib/rateLimit.js';
import { requireAuth, requireCustomer } from '../../middleware/auth.js';
import { sendAttachment } from '../../lib/download.js';
import { createToolSchema } from '../customers/schemas.js';
import { listCatalogs } from '../catalogs/service.js';
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
  sendAttachment(res, meta, stream);
});

const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(1000).optional() });

portalRouter.post('/repairs/:id/quote/decision', limit(30, 15), validate(decisionSchema), async (req, res) => {
  const r = await s.decide(req.customerId!, req.user!.id, id(req.params.id), req.body.decision, {
    comment: req.body.comment, ip: req.ip, userAgent: req.get('user-agent'),
  });
  res.json({ message: req.body.decision === 'APPROVE' ? 'Presupuesto aprobado' : 'Presupuesto rechazado', ...r });
});

// ---------- Pedidos nuevos ----------

portalRouter.get('/tools', async (req, res) => res.json(await s.myTools(req.customerId!)));
portalRouter.get('/catalogs', async (_req, res) => res.json(await listCatalogs()));

// El dueño de la herramienta es siempre el cliente de la sesión, nunca el que diga el cuerpo.
const ownerFromSession: RequestHandler = (req, _res, next) => {
  req.body = { ...req.body, customerId: req.customerId };
  next();
};
portalRouter.post('/tools', limit(30, 15), ownerFromSession, validate(createToolSchema), async (req, res) => {
  const { customerId: _owner, ...input } = req.body;
  res.status(201).json(await s.addMyTool(req.user!.id, req.customerId!, input));
});

const requestSchema = z.object({
  toolId: z.number().int().positive(),
  declaredFault: z.string().trim().min(3, 'Describa la avería').max(2000),
  notes: z.string().trim().max(2000).optional(),
});
portalRouter.post('/repairs', limit(30, 15), validate(requestSchema), async (req, res) => {
  res.status(201).json(await s.requestRepair(req.user!.id, req.customerId!, req.body));
});
portalRouter.post('/repairs/:id/cancel', limit(30, 15), async (req, res) => {
  res.json(await s.cancelRequest(req.user!.id, req.customerId!, id(req.params.id)));
});
