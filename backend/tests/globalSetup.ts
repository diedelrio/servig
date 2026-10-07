import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedRolesAndPermissions } from '../src/lib/seedRoles.js';

// Una sola vez antes de todos los archivos de test (evita carreras al sembrar en paralelo).
export default async function setup() {
  const prisma = new PrismaClient();
  await seedRolesAndPermissions(prisma);
  await prisma.$disconnect();
}
