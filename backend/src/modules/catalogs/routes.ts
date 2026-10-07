import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../lib/http.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as s from './service.js';

const id = (v: unknown) => Number(v);

// Lectura para quien da de alta herramientas; altas, cambios y bajas solo ADMIN (permiso settings:update).
export const catalogsRouter = Router();
catalogsRouter.use(requireAuth);

const name = z.string().trim().min(1, 'El nombre es obligatorio').max(80, 'Máximo 80 caracteres');
const named = z.object({ name });
const model = z.object({ name, brandId: z.number().int().positive(), toolTypeId: z.number().int().positive() });
const write = requirePermission('settings:update');

catalogsRouter.get('/', requirePermission('tool:read'), async (_req, res) => res.json(await s.listCatalogs()));

for (const [path, kind] of [['brands', 'brand'], ['types', 'type']] as const) {
  catalogsRouter.post(`/${path}`, write, validate(named), async (req, res) => res.status(201).json(await s.createNamed(req.user!.id, kind, req.body.name)));
  catalogsRouter.put(`/${path}/:id`, write, validate(named), async (req, res) => res.json(await s.renameNamed(req.user!.id, kind, id(req.params.id), req.body.name)));
  catalogsRouter.delete(`/${path}/:id`, write, async (req, res) => {
    await s.removeNamed(req.user!.id, kind, id(req.params.id));
    res.status(204).end();
  });
}
catalogsRouter.post('/models', write, validate(model), async (req, res) => res.status(201).json(await s.createModel(req.user!.id, req.body)));
catalogsRouter.put('/models/:id', write, validate(model), async (req, res) => res.json(await s.updateModel(req.user!.id, id(req.params.id), req.body)));
catalogsRouter.delete('/models/:id', write, async (req, res) => {
  await s.removeModel(req.user!.id, id(req.params.id));
  res.status(204).end();
});
