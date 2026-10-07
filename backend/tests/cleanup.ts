import type { PrismaClient } from '@prisma/client';

/**
 * Borra todo lo que crearon los tests de un dominio de emails, respetando el orden de las claves foráneas.
 * Alcanza usuarios, clientes (incluidos los sin email, vía sus reparaciones), herramientas, reparaciones y todo lo colgado de ellas.
 */
export async function cleanup(prisma: PrismaClient, domain: string) {
  const users = await prisma.user.findMany({ where: { email: { endsWith: domain } }, select: { id: true } });
  const uIds = users.map((u) => u.id);
  const customers = await prisma.customer.findMany({ where: { email: { endsWith: domain } }, select: { id: true } });
  const repairs = await prisma.repair.findMany({
    where: { OR: [{ customerId: { in: customers.map((c) => c.id) } }, { receivedById: { in: uIds } }] },
    select: { id: true, customerId: true },
  });
  const rIds = repairs.map((r) => r.id);
  const cIds = [...new Set([...customers.map((c) => c.id), ...repairs.map((r) => r.customerId)])];

  const quotes = await prisma.quote.findMany({ where: { repairId: { in: rIds } }, select: { id: true } });
  const versions = await prisma.quoteVersion.findMany({ where: { quoteId: { in: quotes.map((q) => q.id) } }, select: { id: true } });
  const vIds = versions.map((v) => v.id);
  await prisma.quoteApproval.deleteMany({ where: { versionId: { in: vIds } } });
  await prisma.quoteLinkToken.deleteMany({ where: { versionId: { in: vIds } } });
  await prisma.quoteItem.deleteMany({ where: { versionId: { in: vIds } } });
  await prisma.quoteVersion.deleteMany({ where: { id: { in: vIds } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes.map((q) => q.id) } } });
  await prisma.repairSparePart.deleteMany({ where: { repairId: { in: rIds } } });
  await prisma.diagnosis.deleteMany({ where: { repairId: { in: rIds } } });
  await prisma.repairStatusHistory.deleteMany({ where: { repairId: { in: rIds } } });
  await prisma.attachment.deleteMany({ where: { repairId: { in: rIds } } });
  await prisma.repair.deleteMany({ where: { id: { in: rIds } } });
  await prisma.tool.deleteMany({ where: { customerId: { in: cIds } } });
  await prisma.user.updateMany({ where: { customerId: { in: cIds } }, data: { customerId: null } });
  await prisma.customer.deleteMany({ where: { id: { in: cIds } } });

  const where = { userId: { in: uIds } };
  await prisma.emailVerificationToken.deleteMany({ where });
  await prisma.passwordResetToken.deleteMany({ where });
  await prisma.refreshToken.deleteMany({ where });
  // También lo que no tiene usuario: decisiones por enlace sobre estas reparaciones e intentos de login con emails del dominio.
  await prisma.auditLog.deleteMany({
    where: { OR: [where, { entity: 'Repair', entityId: { in: rIds.map(String) } }, { data: { path: ['email'], string_contains: domain } }] },
  });
  await prisma.emailLog.deleteMany({ where: { to: { endsWith: domain } } });
  await prisma.user.deleteMany({ where: { id: { in: uIds } } });
}
