import { app } from './app.js';
import { env } from './lib/env.js';
import { retryFailedEmails } from './lib/email.js';
import { expireDueQuotes } from './modules/quotes/service.js';

app.listen(env.port, () => console.log(`API en http://localhost:${env.port}`));

// Vencimiento de presupuestos: además de comprobarse al leerlos, se barre cada hora.
setInterval(() => expireDueQuotes().catch((e) => console.error('expireDueQuotes', e)), 60 * 60 * 1000).unref();

// Correos fallidos que conservan cuerpo: se reintentan cada 5 minutos, con espera creciente y tope de intentos.
setInterval(() => retryFailedEmails().catch((e) => console.error('retryFailedEmails', e)), 5 * 60 * 1000).unref();
