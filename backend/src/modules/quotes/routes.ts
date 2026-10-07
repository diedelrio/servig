import { Router } from 'express';
import { validate } from '../../lib/http.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as s from './service.js';
import { saveQuoteSchema, withdrawSchema } from './schemas.js';

// Se monta bajo /api/repairs: el presupuesto es un subrecurso de la reparación.
export const quotesRouter = Router();
quotesRouter.use(requireAuth);

const id = (v: unknown) => Number(v);

quotesRouter.get('/:id/quote', requirePermission('quote:read'), async (req, res) => {
  res.json(await s.getQuote(id(req.params.id)));
});

quotesRouter.put('/:id/quote', requirePermission('quote:write'), validate(saveQuoteSchema), async (req, res) => {
  res.json(await s.saveDraft(req.user!.id, id(req.params.id), req.body));
});

quotesRouter.post('/:id/quote/new-version', requirePermission('quote:write'), async (req, res) => {
  res.status(201).json(await s.newVersion(req.user!.id, id(req.params.id)));
});

quotesRouter.post('/:id/quote/send', requirePermission('quote:write'), async (req, res) => {
  res.json(await s.send(req.user!.id, req.user!.role, id(req.params.id)));
});

quotesRouter.post('/:id/quote/resend-link', requirePermission('quote:write'), async (req, res) => {
  res.json(await s.resendLink(req.user!.id, id(req.params.id)));
});

quotesRouter.post('/:id/quote/withdraw', requirePermission('quote:write'), validate(withdrawSchema), async (req, res) => {
  res.json(await s.withdraw(req.user!.id, req.user!.role, id(req.params.id), req.body.comment));
});
