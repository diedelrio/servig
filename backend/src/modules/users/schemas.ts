import { z } from 'zod';
import { ROLES } from '../../lib/seedRoles.js';

const role = z.enum(ROLES);

export const createUserSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email('Email inválido')),
  role,
});

export const updateUserSchema = z
  .object({ role: role.optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() })
  .refine((o) => o.role || o.status, 'Nada que actualizar');
