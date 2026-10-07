import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../lib/http.js';
import { listSettings, resetSetting, updateSetting } from '../../lib/settings.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as ref from './reference.js';

// Solo ADMIN. Lectura y edición de parámetros + datos de referencia de solo lectura.
export const configRouter = Router();
configRouter.use(requireAuth);

configRouter.get('/settings', requirePermission('settings:read'), async (req, res) => {
  const s = req.query.section;
  res.json(await listSettings(s === 'params' || s === 'system' ? s : undefined));
});

configRouter.put('/settings/:key', requirePermission('settings:update'), validate(z.object({ value: z.union([z.string(), z.number()]) })), async (req, res) => {
  res.json(await updateSetting(req.user!.id, String(req.params.key), req.body.value));
});

configRouter.delete('/settings/:key', requirePermission('settings:update'), async (req, res) => {
  res.json(await resetSetting(req.user!.id, String(req.params.key)));
});

const read = requirePermission('settings:read');
configRouter.get('/reference/workflow', read, async (_req, res) => res.json(await ref.workflowRef()));
configRouter.get('/reference/roles', read, async (_req, res) => res.json(await ref.rolesRef()));
configRouter.get('/reference/tables', read, async (_req, res) => res.json(await ref.tablesRef()));
configRouter.get('/reference/catalogs', read, async (_req, res) => res.json(await ref.catalogsRef()));
configRouter.get('/reference/system', read, (_req, res) => res.json({ params: ref.systemRef(), environment: ref.environmentRef() }));
