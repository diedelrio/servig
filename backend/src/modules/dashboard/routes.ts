import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { dashboard } from './service.js';
import { globalSearch } from './search.js';

// Se monta en /api; la autenticación va por ruta para no afectar a ninguna otra que cuelgue de /api.
export const dashboardRouter = Router();

dashboardRouter.get('/dashboard', requireAuth, requirePermission('dashboard:read'), async (_req, res) => {
  res.json(await dashboard());
});

// Mezcla clientes, reparaciones y herramientas: hace falta poder leer todo eso.
dashboardRouter.get('/search', requireAuth, requirePermission('customer:read', 'repair:read', 'tool:read'), async (req, res) => {
  res.json(await globalSearch(typeof req.query.q === 'string' ? req.query.q : ''));
});
