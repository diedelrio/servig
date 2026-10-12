import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../lib/http.js';
import { limit } from '../../lib/rateLimit.js';
import { listCatalogs } from '../catalogs/service.js';
import * as s from './service.js';

// Sin sesión. Límites por IP; el correo de confirmación y el de consulta tienen además su propia espera por email/reparación.
export const publicRouter = Router();

const text = (max: number) => z.string().trim().max(max).optional();
const requestSchema = z
  .object({
    name: z.string().trim().min(1, 'Indique su nombre').max(150),
    email: z.string().trim().toLowerCase().pipe(z.email('Email inválido')),
    phone: text(40),
    modelId: z.number().int().positive().optional(),
    type: z.string().trim().max(80).optional(),
    brand: z.string().trim().max(80).optional(),
    model: z.string().trim().max(80).optional(),
    serialNumber: text(80),
    declaredFault: z.string().trim().min(3, 'Describa la avería').max(2000),
    notes: text(2000),
    website: text(200),
  })
  .superRefine((v, ctx) => {
    if (v.modelId) return;
    for (const [f, msg] of [['type', 'El tipo es obligatorio'], ['brand', 'La marca es obligatoria'], ['model', 'El modelo es obligatorio']] as const) {
      if (!v[f]) ctx.addIssue({ code: 'custom', path: [f], message: msg });
    }
  });

publicRouter.get('/catalogs', limit(60, 15), async (_req, res) => {
  const { brands, types, models } = await listCatalogs();
  res.json({ brands: brands.map(({ id, name }) => ({ id, name })), types: types.map(({ id, name }) => ({ id, name })), models: models.map(({ id, name, brandId, toolTypeId }) => ({ id, name, brandId, toolTypeId })) });
});

publicRouter.post('/requests', limit(10, 60), validate(requestSchema), async (req, res) => {
  await s.createRequest(req.body, req.ip);
  res.status(202).json({ message: s.GENERIC_REQUEST_MESSAGE });
});

publicRouter.post('/requests/confirm', limit(30, 15), validate(z.object({ token: z.string().min(20).max(200) })), async (req, res) => {
  res.json(await s.confirmRequest(req.body.token));
});

publicRouter.post(
  '/lookup', limit(10, 15),
  validate(z.object({ receipt: z.string().trim().min(1, 'Indique el número de resguardo').max(60), email: z.string().trim().toLowerCase().pipe(z.email('Email inválido')) })),
  async (req, res) => {
    await s.requestLookup(req.body.receipt, req.body.email);
    res.status(202).json({ message: s.GENERIC_LOOKUP_MESSAGE });
  },
);

publicRouter.get('/status/:token', limit(60, 15), async (req, res) => {
  res.json(await s.statusByToken(String(req.params.token)));
});
