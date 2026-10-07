import { z } from 'zod';

const money = z.number().finite().min(0, 'No puede ser negativo').max(10_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Máximo 2 decimales');

const fields = {
  code: z.string().trim().max(60).optional(),
  description: z.string().trim().min(1, 'Describe el repuesto').max(300),
  supplier: z.string().trim().max(120).optional(),
  quantity: z.number().int('La cantidad debe ser un número entero').min(1, 'Mínimo 1').max(10_000),
  cost: money,
  price: money,
  notes: z.string().trim().max(1000).optional(),
};

export const createPartSchema = z.object(fields);
export const updatePartSchema = z.object(fields).partial();

export const partStatusSchema = z.object({
  to: z.enum(['SOLICITADO', 'PEDIDO_A_MARCA', 'RECIBIDO', 'INSTALADO', 'CANCELADO']),
  /** Fecha real del pedido o de la recepción (AAAA-MM-DD); por defecto, hoy. */
  date: z.iso.date('Fecha inválida (AAAA-MM-DD)').optional(),
});
