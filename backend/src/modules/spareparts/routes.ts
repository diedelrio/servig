import { Router } from 'express';
import { validate } from '../../lib/http.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as s from './service.js';
import { createPartSchema, partStatusSchema, updatePartSchema } from './schemas.js';

const id = (v: unknown) => Number(v);

// Bajo /api/repairs: listar y agregar repuestos de una reparación.
export const repairPartsRouter = Router();
repairPartsRouter.use(requireAuth);
repairPartsRouter.get('/:id/spare-parts', requirePermission('part:read'), async (req, res) => {
  res.json(await s.list(id(req.params.id)));
});
repairPartsRouter.post('/:id/spare-parts', requirePermission('part:write'), validate(createPartSchema), async (req, res) => {
  res.status(201).json(await s.create(req.user!.id, id(req.params.id), req.body));
});

// Bajo /api/spare-parts: operar sobre un repuesto concreto.
export const partsRouter = Router();
partsRouter.use(requireAuth);
partsRouter.patch('/:id', requirePermission('part:write'), validate(updatePartSchema), async (req, res) => {
  res.json(await s.update(req.user!.id, id(req.params.id), req.body));
});
partsRouter.post('/:id/status', requirePermission('part:write'), validate(partStatusSchema), async (req, res) => {
  res.json(await s.changeStatus(req.user!.id, id(req.params.id), req.body.to, req.body.date));
});
