import type { Response } from 'express';
import type { Readable } from 'node:stream';

/**
 * Entrega un adjunto subido por usuarios. Cabeceras pensadas para contenido no confiable:
 *  - Content-Security-Policy: sandbox → aunque el navegador lo abra, no puede ejecutar scripts ni acceder a la sesión.
 *  - nosniff (helmet) y Content-Type fijado por la detección de contenido, nunca el que declaró quien lo subió.
 */
export function sendAttachment(res: Response, meta: { mime: string; size: number; filename: string }, stream: Readable) {
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('Content-Length', meta.size);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  // Si el archivo desaparece a mitad de la lectura no debe tumbar el proceso: se corta la respuesta y listo.
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
