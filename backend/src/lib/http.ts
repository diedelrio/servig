import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const validate = (schema: ZodType) => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw Object.assign(new HttpError(400, 'Datos inválidos', 'VALIDATION'), { details });
  }
  req.body = r.data;
  next();
};
