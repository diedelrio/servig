import { z } from 'zod';

export const createRepairSchema = z
  .object({
    toolId: z.number().int().positive(),
    declaredFault: z.string().trim().min(1, 'Describe la avería declarada').max(2000),
    visualState: z.string().trim().min(1, 'Describe el estado visual').max(1000),
    accessories: z.string().trim().max(1000).optional(),
    notes: z.string().trim().max(2000).optional(),
    inWarranty: z.boolean().default(false),
    requiresQuote: z.boolean().default(true),
  })
  // RN-02: solo una reparación en garantía puede saltarse el presupuesto.
  .refine((o) => o.requiresQuote || o.inWarranty, {
    message: 'Solo una reparación en garantía puede no requerir presupuesto',
    path: ['requiresQuote'],
  });
