import { app } from './app.js';
import { env } from './lib/env.js';
import { expireDueQuotes } from './modules/quotes/service.js';

app.listen(env.port, () => console.log(`API en http://localhost:${env.port}`));

// Vencimiento de presupuestos: además de comprobarse al leerlos, se barre cada hora.
setInterval(() => expireDueQuotes().catch((e) => console.error('expireDueQuotes', e)), 60 * 60 * 1000).unref();
