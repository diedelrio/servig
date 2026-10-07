import { z } from 'zod';
import { env } from '../../lib/env.js';

// Importes con como máximo 2 decimales (se almacenan y calculan en decimal exacto).
const money = (max: number) =>
  z.number().finite().max(max).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Máximo 2 decimales');

const item = z.object({
  type: z.enum(['LABOR', 'PART', 'OTHER']),
  description: z.string().trim().min(1, 'Describe el concepto').max(300),
  quantity: money(9_999).refine((n) => n > 0, 'La cantidad debe ser mayor que 0'),
  unitPrice: money(999_999.99).refine((n) => n >= 0, 'El precio no puede ser negativo'),
  taxRate: money(100).refine((n) => n >= 0, 'IVA inválido').default(env.quote.defaultTaxRate),
});

export const saveQuoteSchema = z.object({
  items: z.array(item).max(100),
  notes: z.string().trim().max(1000).optional(),
});

export const withdrawSchema = z.object({ comment: z.string().trim().min(1, 'Indica el motivo').max(1000) });

export const diagnosisSchema = z.object({
  text: z.string().trim().min(1, 'Escribe el diagnóstico').max(4000),
  visibleToCustomer: z.boolean().default(false),
});
