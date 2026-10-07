import nodemailer from 'nodemailer';
import { env } from './env.js';
import { prisma } from './prisma.js';

/**
 * Proveedor desacoplado: el resto de la aplicación solo conoce sendEmail(). Cambiar de SMTP a un proveedor por API
 * (Resend, SES…) es implementar `Transport` y llamar a setTransport(); nada más depende de nodemailer.
 */
export type Mail = { from: string; to: string; subject: string; html: string };
export interface Transport {
  send(m: Mail): Promise<void>;
}

const smtp = (): Transport => {
  const t = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
  });
  return { send: async (m) => void (await t.sendMail(m)) };
};

let transport: Transport = smtp();
/** Para tests y para cambiar de proveedor. */
export const setTransport = (t: Transport) => {
  transport = t;
};

export type EmailInput = {
  to: string;
  type: string; // p. ej. AUTH_VERIFY_EMAIL, REPAIR_RECEIVED
  subject: string;
  html: string;
  entity?: string;
  entityId?: string;
};

/**
 * Estos correos llevan un enlace de un solo uso (confirmar cuenta, recuperar contraseña, invitación, aprobar presupuesto).
 * Su cuerpo NO se guarda: quien viera el registro podría usar esos enlaces. Si fallan, la persona los vuelve a solicitar.
 */
export const SENSITIVE_TYPES = new Set(['AUTH_VERIFY_EMAIL', 'AUTH_PASSWORD_RESET', 'AUTH_INVITE', 'QUOTE_AVAILABLE']);

const IMMEDIATE_ATTEMPTS = 3; // dentro del propio envío
export const MAX_ATTEMPTS = 5; // en total, incluidos los reintentos en segundo plano
const IMMEDIATE_DELAYS_MS = [1_000, 3_000];
const BACKOFF_BASE_MS = 5 * 60_000; // el reintento n espera 5 min × 2^(n-1) desde el último intento

const sleep = (ms: number) => (env.isTest ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const mail = (to: string, subject: string, html: string): Mail => ({ from: env.emailFrom, to, subject, html });

/** Un intento de entrega; actualiza el registro y devuelve si salió bien. */
async function attempt(id: number, m: Mail): Promise<boolean> {
  try {
    await transport.send(m);
    await prisma.emailLog.update({
      where: { id },
      data: { status: 'SENT', error: null, attempts: { increment: 1 }, lastAttemptAt: new Date(), sentAt: new Date() },
    });
    return true;
  } catch (e) {
    await prisma.emailLog.update({
      where: { id },
      data: { status: 'FAILED', error: String(e).slice(0, 1000), attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
    return false;
  }
}

/** Envía y siempre deja rastro en EmailLog. Nunca lanza: devuelve true/false. Reintenta unas veces antes de rendirse. */
export async function sendEmail(m: EmailInput): Promise<boolean> {
  const log = await prisma.emailLog.create({
    data: {
      to: m.to, type: m.type, subject: m.subject, entity: m.entity, entityId: m.entityId,
      html: SENSITIVE_TYPES.has(m.type) ? null : m.html,
    },
  });
  const msg = mail(m.to, m.subject, m.html);
  for (let i = 0; i < IMMEDIATE_ATTEMPTS; i++) {
    if (await attempt(log.id, msg)) return true;
    if (i < IMMEDIATE_ATTEMPTS - 1) await sleep(IMMEDIATE_DELAYS_MS[i]);
  }
  return false;
}

/**
 * Reintento en segundo plano de los fallidos que conservan cuerpo, con espera creciente y tope de intentos.
 * Devuelve cuántos reintentó y cuántos salieron bien.
 */
export async function retryFailedEmails(opts: { onlyIds?: number[] } = {}) {
  const candidates = await prisma.emailLog.findMany({
    where: { status: 'FAILED', html: { not: null }, attempts: { lt: MAX_ATTEMPTS }, ...(opts.onlyIds ? { id: { in: opts.onlyIds } } : {}) },
    orderBy: { id: 'asc' },
    take: 50,
  });
  let retried = 0, ok = 0;
  for (const c of candidates) {
    const wait = BACKOFF_BASE_MS * 2 ** Math.max(0, c.attempts - IMMEDIATE_ATTEMPTS);
    if (c.lastAttemptAt && Date.now() - c.lastAttemptAt.getTime() < wait) continue;
    retried++;
    if (await attempt(c.id, mail(c.to, c.subject, c.html!))) ok++;
  }
  return { retried, ok };
}

/** Reintento manual (ADMIN). Sin cuerpo guardado no se puede reenviar. */
export async function retryEmail(id: number): Promise<'SENT' | 'FAILED' | 'NOT_FOUND' | 'NOT_FAILED' | 'NO_BODY'> {
  const c = await prisma.emailLog.findUnique({ where: { id } });
  if (!c) return 'NOT_FOUND';
  if (c.status !== 'FAILED') return 'NOT_FAILED';
  if (!c.html) return 'NO_BODY';
  return (await attempt(c.id, mail(c.to, c.subject, c.html))) ? 'SENT' : 'FAILED';
}
