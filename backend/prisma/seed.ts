import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/security.js';

const prisma = new PrismaClient();

// Los permisos finos (recurso:accion) se irán sembrando por fase; por ahora solo roles.
const ROLES = ['ADMIN', 'RECEPCION', 'TECNICO', 'CLIENTE'];

for (const name of ROLES) await prisma.role.upsert({ where: { name }, update: {}, create: { name } });

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (email && password) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email, firstName: 'Admin', lastName: 'Sistema', roleId: role.id,
      passwordHash: await hashPassword(password), status: 'ACTIVE', emailVerifiedAt: new Date(),
    },
  });
  console.log(`ADMIN listo: ${email}`);
} else {
  console.log('Roles creados. Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD para crear el primer ADMIN.');
}
await prisma.$disconnect();
