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

export const transitionSchema = z.object({
  to: z.enum([
    'SOLICITADA', 'RECIBIDO', 'EN_REVISION', 'PRESUPUESTO_PENDIENTE_APROBACION', 'PRESUPUESTO_APROBADO', 'PRESUPUESTO_RECHAZADO',
    'PEDIDO_REPUESTOS_MARCA', 'EN_REPARACION', 'REPARADO', 'LISTO_PARA_RETIRAR', 'ENTREGADO', 'CANCELADO',
  ]),
  comment: z.string().trim().max(1000).optional(),
  // Solo al registrar la recepción de una solicitud del cliente: lo que se observa al tener la herramienta delante.
  reception: z.object({ visualState: z.string().trim().min(1, 'Describe el estado visual').max(1000), accessories: z.string().trim().max(1000).optional() }).optional(),
});
