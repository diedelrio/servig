import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as s from './service.js';

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission('audit:read'));

auditRouter.get('/', async (req, res) => {
  const q = req.query;
  res.json(await s.listAudit({
    entity: str(q.entity), entityId: str(q.entityId), action: str(q.action), userId: num(q.userId),
    from: date(q.from), to: date(q.to), before: num(q.before), limit: num(q.limit),
  }));
});

auditRouter.get('/actions', async (_req, res) => {
  res.json(await s.auditActions());
});

export const emailLogsRouter = Router();
emailLogsRouter.use(requireAuth);

emailLogsRouter.get('/', requirePermission('emaillog:read'), async (req, res) => {
  const q = req.query;
  res.json(await s.listEmailLogs({ status: str(q.status), type: str(q.type), to: str(q.to), before: num(q.before), limit: num(q.limit) }));
});

emailLogsRouter.post('/:id/retry', requirePermission('emaillog:retry'), async (req, res) => {
  res.json(await s.retryManually(req.user!.id, Number(req.params.id)));
});
