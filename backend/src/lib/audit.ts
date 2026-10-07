import { prisma } from './prisma.js';

export const audit = (action: string, entity: string, entityId?: string | number, userId?: number | null, data?: object, ip?: string) =>
  prisma.auditLog.create({
    data: { action, entity, entityId: entityId?.toString(), userId: userId ?? undefined, data, ip },
  });
