import { audit } from '../../lib/audit.js';
import { sendEmail } from '../../lib/email.js';
import { publicRequestConfirmMail, repairStatusLinkMail } from '../../lib/emailTemplates.js';
import { HttpError } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { hashToken, minutes, newToken } from '../../lib/security.js';
import { getBusiness, getNumber } from '../../lib/settings.js';
import { linkCustomerByEmail } from '../../lib/customerLink.js';
import { resolveModel } from '../catalogs/service.js';
import { nextNumber } from '../repairs/service.js';

/**
 * Flujo público (sin sesión). Nada se crea hasta que el dueño del email confirma desde su correo: así nadie puede llenar de
 * fichas ni de reparaciones ajenas el portal de otra persona (el email es lo que asocia la reparación a su dueño).
 */

const COOLDOWN_MS = 60_000; // espera mínima entre correos al mismo email o para la misma reparación
const DAILY_MAX_PER_EMAIL = 5; // solicitudes pendientes por email y día

export type RequestInput = {
  name: string; email: string; phone?: string; modelId?: number
  type?: string; brand?: string; model?: string; serialNumber?: string
  declaredFault: string; notes?: string
  /** Campo trampa: las personas no lo ven ni lo rellenan; un robot sí. */
  website?: string
}

export const GENERIC_REQUEST_MESSAGE = 'Si el correo es válido, le hemos enviado un mensaje para confirmar la solicitud.';
export const GENERIC_LOOKUP_MESSAGE = 'Si los datos coinciden con una reparación, le hemos enviado un enlace de consulta a ese correo.';

export async function createRequest(i: RequestInput, ip?: string) {
  if (i.website) return; // robot: respuesta idéntica, no se hace nada
  const email = i.email.toLowerCase();
  const since = new Date(Date.now() - COOLDOWN_MS);
  const day = new Date(Date.now() - 86_400_000);
  const [recent, today] = await Promise.all([
    prisma.publicRequest.count({ where: { email, createdAt: { gt: since } } }),
    prisma.publicRequest.count({ where: { email, createdAt: { gt: day } } }),
  ]);
  if (recent > 0 || today >= DAILY_MAX_PER_EMAIL) return; // frena el envío masivo a un mismo correo, sin avisar

  const tool = i.modelId ? await resolveModel(i.modelId) : { modelId: null, type: i.type!, brand: i.brand!, model: i.model! };
  const token = newToken();
  const hours = await getNumber('link.publicConfirmHours');
  const row = await prisma.publicRequest.create({
    data: {
      email, name: i.name, phone: i.phone || null, modelId: tool.modelId, type: tool.type, brand: tool.brand, model: tool.model,
      serialNumber: i.serialNumber || null, declaredFault: i.declaredFault, notes: i.notes || null,
      tokenHash: hashToken(token), expiresAt: minutes(hours * 60), ip: ip?.slice(0, 64),
    },
  });
  await sendEmail({
    to: email, type: 'PUBLIC_REQUEST_CONFIRM', entity: 'PublicRequest', entityId: String(row.id),
    ...publicRequestConfirmMail(i.name, token, hours),
  });
}

/** Confirmación desde el correo: aquí nace la reparación (SOLICITADA) asociada al email. Idempotente. */
export async function confirmRequest(token: string) {
  const r = await prisma.publicRequest.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!r) throw new HttpError(404, 'Enlace no válido');
  if (r.confirmedAt && r.repairId) {
    const done = await prisma.repair.findUniqueOrThrow({ where: { id: r.repairId }, select: { number: true } });
    return { number: done.number, already: true };
  }
  if (r.expiresAt < new Date()) throw new HttpError(410, 'El enlace venció; envíe la solicitud de nuevo', 'LINK_EXPIRED');

  const repair = await prisma.$transaction(async (tx) => {
    // Quien llegue primero la confirma; una segunda petición simultánea no duplica nada.
    const claim = await tx.publicRequest.updateMany({ where: { id: r.id, confirmedAt: null }, data: { confirmedAt: new Date() } });
    if (claim.count === 0) return null;
    // Un email que ya tiene ficha usa esa ficha (sin tocar sus datos); si no, se crea con lo que escribió.
    const customer =
      (await tx.customer.findUnique({ where: { email: r.email } })) ??
      (await tx.customer.create({ data: { name: r.name, email: r.email, phone: r.phone } }));
    const tool = await tx.tool.create({
      data: { customerId: customer.id, type: r.type, brand: r.brand, model: r.model, serialNumber: r.serialNumber, modelId: r.modelId },
    });
    const rep = await tx.repair.create({
      data: {
        number: await nextNumber(tx), customerId: customer.id, toolId: tool.id, declaredFault: r.declaredFault,
        visualState: 'Pendiente de registrar al recibir la herramienta', notes: r.notes,
        status: 'SOLICITADA', inWarranty: false, requiresQuote: true, receivedById: null,
      },
    });
    await tx.repairStatusHistory.create({
      data: { repairId: rep.id, fromStatus: null, toStatus: 'SOLICITADA', userId: null, comment: 'Solicitud desde la web pública', origin: 'SYSTEM' },
    });
    await tx.publicRequest.update({ where: { id: r.id }, data: { repairId: rep.id } });
    return { rep, customer };
  });
  if (!repair) return confirmRequest(token); // la otra petición ya la creó: devuelve su resultado

  await linkCustomerByEmail(r.email); // si ya tenía cuenta del portal, la ve ahí
  await audit('REPAIR_REQUESTED', 'Repair', repair.rep.id, null, { number: repair.rep.number, via: 'web', customerId: repair.customer.id }, r.ip ?? undefined);
  await sendStatusLink(repair.rep.id, repair.rep.number, repair.customer.name, r.email, { welcome: true, tool: `${r.brand} ${r.model}`, fault: r.declaredFault });
  return { number: repair.rep.number, already: false };
}

/** Crea un enlace temporal de consulta (solo lectura) y lo envía al email de la ficha. */
async function sendStatusLink(
  repairId: number, number: string, name: string, to: string,
  opts: { welcome?: boolean; tool?: string; fault?: string } = {},
) {
  const token = newToken();
  const hours = await getNumber('link.statusViewHours');
  await prisma.repairViewToken.create({ data: { repairId, tokenHash: hashToken(token), expiresAt: minutes(hours * 60) } });
  await sendEmail({
    to, type: 'REPAIR_STATUS_LINK', entity: 'Repair', entityId: String(repairId),
    ...repairStatusLinkMail(name, { number, token, hours, ...opts }),
  });
}

/**
 * Consulta anónima: con el nº de resguardo (el de la reparación o el del sistema contable) y el email, se envía el enlace al
 * correo de la ficha. La respuesta es siempre la misma, coincida o no, para no revelar qué reparaciones ni correos existen.
 */
export async function requestLookup(receipt: string, emailRaw: string) {
  const email = emailRaw.toLowerCase();
  const repair = await prisma.repair.findFirst({
    where: {
      customer: { email },
      OR: [{ number: { equals: receipt, mode: 'insensitive' } }, { accountingReceipt: { equals: receipt, mode: 'insensitive' } }],
    },
    include: { customer: true },
  });
  if (!repair) return;
  const recent = await prisma.repairViewToken.count({ where: { repairId: repair.id, createdAt: { gt: new Date(Date.now() - COOLDOWN_MS) } } });
  if (recent > 0) return;
  await audit('REPAIR_STATUS_LINK_SENT', 'Repair', repair.id, null, { via: 'lookup' });
  await sendStatusLink(repair.id, repair.number, repair.customer.name, email);
}

/** Estado de la reparación para quien tiene el enlace temporal. Solo lectura y sin importes ni datos personales. */
export async function statusByToken(token: string) {
  const t = await prisma.repairViewToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!t) throw new HttpError(404, 'Enlace no válido');
  if (t.expiresAt < new Date()) throw new HttpError(410, 'El enlace venció; pida uno nuevo desde la página de consulta', 'LINK_EXPIRED');
  const r = await prisma.repair.findUniqueOrThrow({
    where: { id: t.repairId },
    include: { tool: true, history: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } }, quote: { include: { versions: { select: { version: true, status: true } } } } },
  });
  const cur = r.quote?.versions.find((v) => v.version === r.quote!.currentVersion);
  const business = await getBusiness();
  return {
    number: r.number, status: r.status, receivedAt: r.receivedAt,
    tool: { type: r.tool.type, brand: r.tool.brand, model: r.tool.model },
    declaredFault: r.declaredFault,
    timeline: r.history.map((h) => ({ status: h.toStatus, at: h.createdAt })),
    // Decidir el presupuesto exige usuario (RN-35): aquí solo se avisa de que hay uno esperando.
    quoteWaiting: r.status === 'PRESUPUESTO_PENDIENTE_APROBACION' && cur?.status === 'ENVIADO',
    expiresAt: t.expiresAt,
    business: { name: business.name, phone: business.phone },
  };
}
