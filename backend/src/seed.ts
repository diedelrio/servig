import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from './lib/security.js';
import { seedRolesAndPermissions } from './lib/seedRoles.js';

/** En producción no se crea un administrador con una contraseña débil o de ejemplo. Devuelve el problema, o null si está bien. */
export function adminPasswordProblem(password: string, isProd: boolean): string | null {
  if (!isProd) return null;
  if (password.length < 12) return 'SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres en producción';
  if (/cambia-?esto|change-?me|admin12345|password/i.test(password)) return 'SEED_ADMIN_PASSWORD parece una contraseña de ejemplo';
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedRolesAndPermissions(prisma);

    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password) {
      console.log('Roles creados. Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD para crear el primer ADMIN.');
      return;
    }
    const problem = adminPasswordProblem(password, process.env.NODE_ENV === 'production');
    if (problem) throw new Error(problem);

    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Nunca se pisa la contraseña de un usuario que ya existe: el seed es seguro de repetir.
      console.log(`ADMIN ya existía: ${email} (no se modificó)`);
      return;
    }
    await prisma.user.create({
      data: {
        email, firstName: 'Admin', lastName: 'Sistema', roleId: role.id,
        passwordHash: await hashPassword(password), status: 'ACTIVE', emailVerifiedAt: new Date(),
      },
    });
    console.log(`ADMIN creado: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Solo se ejecuta al invocarlo como script, no al importarlo desde un test.
if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
