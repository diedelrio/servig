import { z } from 'zod';

// Texto opcional: vacío = sin dato. Se normaliza a null al guardar.
const text = (max: number) => z.string().trim().max(max).optional();
const email = z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Email inválido'))]).optional();
// DNI/NIF/CIF: sin espacios, puntos ni guiones, en mayúsculas.
const taxId = z.string().trim().max(30).transform((v) => v.replace(/[\s.-]/g, '').toUpperCase()).optional();
const date = z.union([z.literal(''), z.iso.date('Fecha inválida (AAAA-MM-DD)')]).optional();

const customerFields = {
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(150),
  taxId,
  email,
  phone: text(40),
  address: text(250),
  notes: text(2000),
};
export const createCustomerSchema = z.object(customerFields);
export const updateCustomerSchema = z.object(customerFields).partial();

const toolFields = {
  type: z.string().trim().min(1, 'El tipo es obligatorio').max(80),
  brand: z.string().trim().min(1, 'La marca es obligatoria').max(80),
  model: z.string().trim().min(1, 'El modelo es obligatorio').max(80),
  serialNumber: text(80),
  purchaseDate: date,
  warrantyExpiresAt: date,
  description: text(1000),
  notes: text(2000),
};
// Con modelId se toman marca, tipo y modelo del catálogo; sin él, se escriben a mano (los tres obligatorios).
const modelId = z.number().int().positive().optional();
export const createToolSchema = z
  .object({ customerId: z.number().int().positive(), modelId, ...toolFields, type: toolFields.type.optional(), brand: toolFields.brand.optional(), model: toolFields.model.optional() })
  .superRefine((v, ctx) => {
    if (v.modelId) return;
    for (const [f, msg] of [['type', 'El tipo es obligatorio'], ['brand', 'La marca es obligatoria'], ['model', 'El modelo es obligatorio']] as const) {
      if (!v[f]) ctx.addIssue({ code: 'custom', path: [f], message: msg });
    }
  });
// El dueño de una herramienta no se cambia.
export const updateToolSchema = z.object({ modelId, ...toolFields }).partial();
