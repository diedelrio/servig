import { z } from 'zod';

// Lista mínima; ampliar con una lista real de contraseñas filtradas si hace falta.
const COMMON = ['password12', 'contraseña1', '1234567890', 'qwertyuiop', 'password123', 'administrador1'];

export const passwordSchema = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .max(128, 'Máximo 128 caracteres')
  .regex(/[A-Za-z]/, 'Debe incluir al menos una letra')
  .regex(/\d/, 'Debe incluir al menos un número')
  .refine((p) => !COMMON.includes(p.toLowerCase()), 'Contraseña demasiado común');

const email = z.string().trim().toLowerCase().pipe(z.email('Email inválido'));
const matching = (o: { password: string; confirmPassword: string }) => o.password === o.confirmPassword;
const matchMsg = { message: 'Las contraseñas no coinciden', path: ['confirmPassword'] };

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine(matching, matchMsg);

export const emailOnlySchema = z.object({ email });
export const tokenSchema = z.object({ token: z.string().min(1) });
export const loginSchema = z.object({ email, password: z.string().min(1) });
export const resetSchema = z
  .object({ token: z.string().min(1), password: passwordSchema, confirmPassword: z.string() })
  .refine(matching, matchMsg);
