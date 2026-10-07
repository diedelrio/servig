import { Router } from 'express';
import { validate } from '../../lib/http.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as s from './service.js';
import { createUserSchema, updateUserSchema } from './schemas.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

usersRouter.get('/', requirePermission('user:read'), async (req, res) => {
  res.json(await s.list({ search: str(req.query.search), role: str(req.query.role), status: str(req.query.status) }));
});

usersRouter.post('/', requirePermission('user:create'), validate(createUserSchema), async (req, res) => {
  res.status(201).json(await s.create(req.user!.id, req.body));
});

usersRouter.patch('/:id', requirePermission('user:update'), validate(updateUserSchema), async (req, res) => {
  res.json(await s.update(req.user!.id, Number(req.params.id), req.body));
});

usersRouter.post('/:id/resend-invite', requirePermission('user:update'), async (req, res) => {
  await s.resendInvite(req.user!.id, Number(req.params.id));
  res.status(202).json({ message: 'Invitación reenviada' });
});
