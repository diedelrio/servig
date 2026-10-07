import { currentIp } from './requestContext.js';
import { prisma } from './prisma.js';

/** Registra una operación importante. Si no se indica la IP, se toma la de la petición en curso. */
export const audit = (action: string, entity: string, entityId?: string | number, userId?: number | null, data?: object, ip?: string) =>
  prisma.auditLog.create({
    data: { action, entity, entityId: entityId?.toString(), userId: userId ?? undefined, data, ip: ip ?? currentIp() },
  });
