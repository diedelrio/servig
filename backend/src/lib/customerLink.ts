import { prisma } from './prisma.js';

/**
 * RN-09: la cuenta CLIENTE activa se vincula al Customer con su mismo email.
 * Se invoca al activar una cuenta y al crear/editar un cliente, así el orden no importa.
 */
export async function linkCustomerByEmail(email: string | null | undefined) {
  if (!email) return;
  const customer = await prisma.customer.findUnique({ where: { email } });
  if (!customer) return;
  await prisma.user.updateMany({
    where: { email, customerId: null, status: 'ACTIVE', role: { name: 'CLIENTE' } },
    data: { customerId: customer.id },
  });
}
