import express, { Router } from 'express';
import { z } from 'zod';
import { HttpError, validate } from '../../lib/http.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as s from './service.js';
import { accountingReceiptSchema, createRepairSchema, transitionSchema } from './schemas.js';
import { transitionRepair } from './workflow.js';
import { diagnosisSchema } from '../quotes/schemas.js';
import { sendAttachment } from '../../lib/download.js';

export const repairsRouter = Router();
repairsRouter.use(requireAuth);

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => Number(v);

repairsRouter.get('/', requirePermission('repair:read'), async (req, res) => {
  const customerId = req.query.customerId ? num(req.query.customerId) : undefined;
  res.json(await s.listRepairs({ status: str(req.query.status), search: str(req.query.search), customerId, filter: str(req.query.filter) }));
});

repairsRouter.post('/', requirePermission('repair:create'), validate(createRepairSchema), async (req, res) => {
  res.status(201).json(await s.createRepair(req.user!.id, req.user!.role, req.body));
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
    // La regla SOLICITADA → RECIBIDO es la única que llega a RECIBIDO: aquí solo se completan los datos de la recepción.
    inTx: req.body.to === 'RECIBIDO' && req.body.reception
      ? async (tx) => { await tx.repair.update({ where: { id: num(req.params.id) }, data: { visualState: req.body.reception.visualState, accessories: req.body.reception.accessories || null } }); }
      : undefined,
  });
  res.json(repair);
});

repairsRouter.put('/:id/accounting-receipt', requirePermission('repair:accounting'), validate(accountingReceiptSchema), async (req, res) => {
  res.json(await s.setAccountingReceipt(req.user!.id, num(req.params.id), req.body.number));
});

repairsRouter.post('/:id/diagnosis', requirePermission('diagnosis:create'), validate(diagnosisSchema), async (req, res) => {
  res.status(201).json(await s.addDiagnosis(req.user!.id, num(req.params.id), req.body));
});

// El archivo viaja como cuerpo binario crudo; el nombre original, en la cabecera x-filename.
// El tipo real se valida por contenido en el servicio, no por el Content-Type declarado.
const rawFile = express.raw({ type: () => true, limit: s.MAX_FILE_BYTES });

repairsRouter.post('/:id/attachments', requirePermission('repair:attach'), rawFile, async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Falta el archivo');
  const raw = str(req.headers['x-filename']) ?? 'archivo';
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* un % suelto no es una codificación válida: se usa el texto tal cual en vez de fallar con un 500 */
  }
  res.status(201).json(await s.addAttachment(req.user!.id, num(req.params.id), name, req.body));
});

repairsRouter.patch('/:id/attachments/:attId', requirePermission('repair:attach'), validate(z.object({ visibleToCustomer: z.boolean() })), async (req, res) => {
  res.json(await s.setAttachmentVisibility(req.user!.id, num(req.params.id), num(req.params.attId), req.body.visibleToCustomer));
});

repairsRouter.get('/:id/attachments/:attId', requirePermission('repair:read'), async (req, res) => {
  const { meta, stream } = await s.getAttachment(num(req.params.id), num(req.params.attId));
  sendAttachment(res, meta, stream);
});
