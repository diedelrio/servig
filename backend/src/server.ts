import { app } from './app.js';
import { env } from './lib/env.js';
import { retryFailedEmails } from './lib/email.js';
import { prisma } from './lib/prisma.js';
import { expireDueQuotes } from './modules/quotes/service.js';

const server = app.listen(env.port, () => console.log(`API en http://localhost:${env.port}`));

// Vencimiento de presupuestos: además de comprobarse al leerlos, se barre cada hora.
setInterval(() => expireDueQuotes().catch((e) => console.error('expireDueQuotes', e)), 60 * 60 * 1000).unref();

// Correos fallidos que conservan cuerpo: se reintentan cada 5 minutos, con espera creciente y tope de intentos.
setInterval(() => retryFailedEmails().catch((e) => console.error('retryFailedEmails', e)), 5 * 60 * 1000).unref();

// Cierre ordenado: el PaaS envía SIGTERM en cada despliegue. Se dejan terminar las peticiones en curso antes de salir.
function shutdown(signal: string) {
  console.log(`${signal} recibido: cerrando…`);
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // si algo no cierra, no se queda colgado
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
