import { env } from './env.js';

/**
 * Ejecuta la función sin hacer esperar a quien llamó (en producción), o esperándola (wait).
 * Sirve para el envío de correos en los flujos anti-enumeración: si responder tardara más cuando el usuario existe
 * (porque hay que mandar un correo), la diferencia de tiempo delataría qué emails están registrados.
 */
export async function runBackground(fn: () => Promise<unknown>, wait: boolean) {
  if (wait) {
    await fn();
    return;
  }
  void fn().catch((e) => console.error('[background]', e));
}

/** En tests se espera (para poder comprobar el resultado); en producción no. */
export const defer = (fn: () => Promise<unknown>) => runBackground(fn, env.isTest);
