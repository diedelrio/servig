import { Router } from 'express';
import { validate } from '../../lib/http.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as s from './service.js';
import { createCustomerSchema, createToolSchema, updateCustomerSchema, updateToolSchema } from './schemas.js';

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const id = (v: unknown) => Number(v);

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get('/', requirePermission('customer:read'), async (req, res) => {
  res.json(await s.listCustomers(str(req.query.search)));
});
customersRouter.get('/:id', requirePermission('customer:read'), async (req, res) => {
  res.json(await s.getCustomer(id(req.params.id)));
});
customersRouter.post('/', requirePermission('customer:create'), validate(createCustomerSchema), async (req, res) => {
  res.status(201).json(await s.createCustomer(req.user!.id, req.body));
});
customersRouter.patch('/:id', requirePermission('customer:update'), validate(updateCustomerSchema), async (req, res) => {
  res.json(await s.updateCustomer(req.user!.id, id(req.params.id), req.body));
});

export const toolsRouter = Router();
toolsRouter.use(requireAuth);

toolsRouter.get('/', requirePermission('tool:read'), async (req, res) => {
  const customerId = req.query.customerId ? id(req.query.customerId) : undefined;
  res.json(await s.listTools({ customerId, search: str(req.query.search) }));
});
toolsRouter.get('/:id', requirePermission('tool:read'), async (req, res) => {
  res.json(await s.getTool(id(req.params.id)));
});
toolsRouter.post('/', requirePermission('tool:create'), validate(createToolSchema), async (req, res) => {
  res.status(201).json(await s.createTool(req.user!.id, req.body));
});
toolsRouter.patch('/:id', requirePermission('tool:update'), validate(updateToolSchema), async (req, res) => {
  res.json(await s.updateTool(req.user!.id, id(req.params.id), req.body));
});
