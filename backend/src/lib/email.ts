import nodemailer from 'nodemailer';
import { env } from './env.js';
import { prisma } from './prisma.js';

const transport = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
});

export type EmailInput = {
  to: string;
  type: string; // p. ej. AUTH_VERIFY_EMAIL, REPAIR_RECEIVED
  subject: string;
  html: string;
  entity?: string;
  entityId?: string;
};

/** Envía un email y siempre deja rastro en EmailLog. Nunca lanza: devuelve true/false. */
export async function sendEmail(m: EmailInput): Promise<boolean> {
  const log = await prisma.emailLog.create({
    data: { to: m.to, type: m.type, subject: m.subject, entity: m.entity, entityId: m.entityId },
  });
  try {
    await transport.sendMail({ from: env.emailFrom, to: m.to, subject: m.subject, html: m.html });
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date() },
    });
    return true;
  } catch (e) {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'FAILED', attempts: { increment: 1 }, error: String(e) },
    });
    return false;
  }
}
