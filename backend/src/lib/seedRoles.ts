import type { PrismaClient } from '@prisma/client';

export const ROLES = ['ADMIN', 'RECEPCION', 'TECNICO', 'CLIENTE'] as const;

// Permisos por rol. Cada fase agrega los suyos aquí; ADMIN recibe todos automáticamente.
const CUSTOMER_TOOL = ['customer:read', 'customer:create', 'customer:update', 'tool:read', 'tool:create', 'tool:update'];
const GRANTS: Record<string, string[]> = {
  ADMIN: ['user:read', 'user:create', 'user:update', ...CUSTOMER_TOOL, 'repair:read', 'repair:create', 'repair:attach', 'repair:transition', 'diagnosis:create', 'quote:read', 'quote:write', 'part:read', 'part:write', 'audit:read', 'emaillog:read', 'emaillog:retry'],
  RECEPCION: [...CUSTOMER_TOOL, 'repair:read', 'repair:create', 'repair:attach', 'repair:transition', 'quote:read', 'part:read'],
  TECNICO: ['customer:read', 'tool:read', 'repair:read', 'repair:attach', 'repair:transition', 'diagnosis:create', 'quote:read', 'quote:write', 'part:read', 'part:write'],
  CLIENTE: [],
};

/** Idempotente: se usa en el seed y en los tests. */
export async function seedRolesAndPermissions(prisma: PrismaClient) {
  const all = [...new Set(Object.values(GRANTS).flat())];
  for (const code of all) await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
  for (const name of ROLES) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    const codes = name === 'ADMIN' ? all : GRANTS[name];
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
}
