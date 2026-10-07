import express, { Router } from 'express';
import { HttpError, validate } from '../../lib/http.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as s from './service.js';
import { createRepairSchema, transitionSchema } from './schemas.js';
import { transitionRepair } from './workflow.js';
import { diagnosisSchema } from '../quotes/schemas.js';

export const repairsRouter = Router();
repairsRouter.use(requireAuth);

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => Number(v);

repairsRouter.get('/', requirePermission('repair:read'), async (req, res) => {
  const customerId = req.query.customerId ? num(req.query.customerId) : undefined;
  res.json(await s.listRepairs({ status: str(req.query.status), search: str(req.query.search), customerId }));
});

repairsRouter.post('/', requirePermission('repair:create'), validate(createRepairSchema), async (req, res) => {
  res.status(201).json(await s.createRepair(req.user!.id, req.body));
});

repairsRouter.get('/:id', requirePermission('repair:read'), async (req, res) => {
  res.json(await s.getRepair(num(req.params.id), req.user!.role));
});

repairsRouter.post('/:id/transition', requirePermission('repair:transition'), validate(transitionSchema), async (req, res) => {
  const repair = await transitionRepair({
    repairId: num(req.params.id),
    to: req.body.to,
    comment: req.body.comment,
    actor: { userId: req.user!.id, role: req.user!.role, origin: 'STAFF' },
  });
  res.json(repair);
});

repairsRouter.post('/:id/diagnosis', requirePermission('diagnosis:create'), validate(diagnosisSchema), async (req, res) => {
  res.status(201).json(await s.addDiagnosis(req.user!.id, num(req.params.id), req.body));
});

// El archivo viaja como cuerpo binario crudo; el nombre original, en la cabecera x-filename.
// El tipo real se valida por contenido en el servicio, no por el Content-Type declarado.
const rawFile = express.raw({ type: () => true, limit: s.MAX_FILE_BYTES });

repairsRouter.post('/:id/attachments', requirePermission('repair:attach'), rawFile, async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Falta el archivo');
  const name = decodeURIComponent(str(req.headers['x-filename']) ?? 'archivo');
  res.status(201).json(await s.addAttachment(req.user!.id, num(req.params.id), name, req.body));
});

repairsRouter.get('/:id/attachments/:attId', requirePermission('repair:read'), async (req, res) => {
  const { meta, stream } = await s.getAttachment(num(req.params.id), num(req.params.attId));
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('Content-Length', meta.size);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  stream.pipe(res);
});
