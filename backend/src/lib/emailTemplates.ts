import { env } from './env.js';

const wrap = (body: string) => `<div style="font-family:sans-serif;max-width:480px">${body}</div>`;
const link = (path: string, token: string) => `${env.frontendUrl}${path}?token=${encodeURIComponent(token)}`;

export const verifyEmailMail = (name: string, token: string) => ({
  subject: 'Confirma tu cuenta',
  html: wrap(`<p>Hola ${name}, bienvenido. Para activar tu cuenta haz clic en el siguiente enlace:</p>
    <p><a href="${link('/verify-email', token)}">Activar cuenta</a></p><p>El enlace vence en 24 horas.</p>`),
});

export const resetPasswordMail = (name: string, token: string) => ({
  subject: 'Recupera tu contraseña',
  html: wrap(`<p>Hola ${name}, recibimos una solicitud para restablecer tu contraseña:</p>
    <p><a href="${link('/reset-password', token)}">Definir nueva contraseña</a></p>
    <p>El enlace vence en 1 hora. Si no fuiste tú, ignora este mensaje.</p>`),
});

export const passwordChangedMail = (name: string) => ({
  subject: 'Tu contraseña fue cambiada',
  html: wrap(`<p>Hola ${name}, tu contraseña se cambió correctamente. Si no fuiste tú, contacta con el taller.</p>`),
});
