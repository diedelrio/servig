import { env } from './env.js';

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const wrap = (body: string) => `<div style="font-family:sans-serif;max-width:480px">${body}</div>`;
const link = (path: string, token: string) => `${env.frontendUrl}${path}?token=${encodeURIComponent(token)}`;

export const verifyEmailMail = (name: string, token: string) => ({
  subject: 'Confirma tu cuenta',
  html: wrap(`<p>Hola ${esc(name)}, bienvenido. Para activar tu cuenta haz clic en el siguiente enlace:</p>
    <p><a href="${link('/verify-email', token)}">Activar cuenta</a></p><p>El enlace vence en 24 horas.</p>`),
});

export const resetPasswordMail = (name: string, token: string) => ({
  subject: 'Recupera tu contraseña',
  html: wrap(`<p>Hola ${esc(name)}, recibimos una solicitud para restablecer tu contraseña:</p>
    <p><a href="${link('/reset-password', token)}">Definir nueva contraseña</a></p>
    <p>El enlace vence en 1 hora. Si no fuiste tú, ignora este mensaje.</p>`),
});

export const inviteMail = (name: string, role: string, token: string) => ({
  subject: 'Te invitamos a Servig',
  html: wrap(`<p>Hola ${esc(name)}, se creó tu cuenta con el rol <b>${esc(role)}</b>. Define tu contraseña para activarla:</p>
    <p><a href="${link('/reset-password', token)}">Definir contraseña</a></p><p>El enlace vence en 72 horas.</p>`),
});

export const repairReceivedMail = (name: string, r: { number: string; tool: string; fault: string }) => ({
  subject: `Herramienta recibida · ${r.number}`,
  html: wrap(`<p>Hola ${esc(name)}, hemos recibido su herramienta para diagnóstico.</p>
    <p><b>Reparación:</b> ${r.number}<br><b>Herramienta:</b> ${esc(r.tool)}<br><b>Avería declarada:</b> ${esc(r.fault)}</p>
    <p>Le avisaremos cuando el presupuesto esté disponible. No se realizará ninguna reparación sin su aprobación.</p>`),
});

export const repairRequestedMail = (name: string, r: { number: string; tool: string; fault: string }) => ({
  subject: `Solicitud de reparación registrada · ${r.number}`,
  html: wrap(`<p>Hola ${esc(name)}, hemos registrado su solicitud de reparación.</p>
    <p><b>Solicitud:</b> ${r.number}<br><b>Herramienta:</b> ${esc(r.tool)}<br><b>Avería indicada:</b> ${esc(r.fault)}</p>
    <p>Traiga la herramienta al taller para que la recibamos y la revisemos. Le avisaremos cuando el presupuesto esté disponible; no se realizará ninguna reparación sin su aprobación.</p>`),
});

/** El enlace de aprobación (Fase 7) se pasa en approvalUrl; sin él, el correo es solo informativo. */
export const quoteAvailableMail = (name: string, q: { number: string; tool: string; total: string; validUntil: Date; approvalUrl?: string }) => ({
  subject: `Presupuesto disponible · ${q.number}`,
  html: wrap(`<p>Hola ${esc(name)}, ya está disponible el presupuesto de su ${esc(q.tool)} (${esc(q.number)}).</p>
    <p><b>Total (IVA incluido):</b> ${esc(q.total)} €<br><b>Válido hasta:</b> ${q.validUntil.toLocaleDateString('es-ES')}</p>
    ${q.approvalUrl ? `<p><a href="${q.approvalUrl}">Ver y aprobar o rechazar el presupuesto</a></p>` : ''}
    <p>No se realizará ninguna reparación sin su aprobación expresa.</p>`),
});

type Decision = 'APROBADO' | 'RECHAZADO';

/** Confirmación al cliente de la decisión que acaba de registrar. */
export const quoteDecisionMail = (name: string, q: { number: string; tool: string; total: string; decision: Decision }) => ({
  subject: `Presupuesto ${q.decision === 'APROBADO' ? 'aprobado' : 'rechazado'} · ${q.number}`,
  html: wrap(
    q.decision === 'APROBADO'
      ? `<p>Hola ${esc(name)}, hemos registrado su aprobación del presupuesto de ${esc(q.tool)} (${esc(q.number)}) por ${esc(q.total)} €.</p>
         <p>Comenzaremos la reparación y le avisaremos cuando esté lista.</p>`
      : `<p>Hola ${esc(name)}, hemos registrado que rechaza el presupuesto de ${esc(q.tool)} (${esc(q.number)}).</p>
         <p>No se realizará ninguna reparación. Nos pondremos en contacto con usted para los siguientes pasos.</p>`,
  ),
});

/** Aviso interno al técnico que envió el presupuesto. */
export const staffQuoteDecisionMail = (name: string, q: { number: string; customer: string; total: string; decision: Decision; comment?: string | null }) => ({
  subject: `El cliente ${q.decision === 'APROBADO' ? 'aprobó' : 'rechazó'} el presupuesto · ${q.number}`,
  html: wrap(`<p>Hola ${esc(name)}, ${esc(q.customer)} ${q.decision === 'APROBADO' ? 'aprobó' : 'rechazó'} el presupuesto de ${esc(q.number)} (${esc(q.total)} €).</p>
    ${q.comment ? `<p>Comentario del cliente: ${esc(q.comment)}</p>` : ''}`),
});

export const repairFinishedMail =(name: string, r: { number: string; tool: string }) => ({
  subject: `Reparación finalizada · ${r.number}`,
  html: wrap(`<p>Hola ${esc(name)}, la reparación de su ${esc(r.tool)} (${esc(r.number)}) ha finalizado.</p>
    <p>En breve le avisaremos cuando esté lista para retirar.</p>`),
});

export const repairReadyMail = (name: string, r: { number: string; tool: string }) => ({
  subject: `Lista para retirar · ${r.number}`,
  html: wrap(`<p>Hola ${esc(name)}, su ${esc(r.tool)} (${esc(r.number)}) está lista para retirar.</p>
    <p>Recuerde traer el resguardo de recepción.</p>`),
});

export const passwordChangedMail =(name: string) => ({
  subject: 'Tu contraseña fue cambiada',
  html: wrap(`<p>Hola ${esc(name)}, tu contraseña se cambió correctamente. Si no fuiste tú, contacta con el taller.</p>`),
});
