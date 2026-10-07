import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from './env.js';

/**
 * Interfaz mínima de almacenamiento. Hoy usa disco; para S3/R2 se reemplazan estas
 * dos funciones (la clave que devuelve save() es lo único que se guarda en la BD).
 */
const root = () => resolve(env.uploadDir);

export async function save(data: Buffer, ext: string): Promise<string> {
  const key = `${new Date().getFullYear()}/${randomUUID()}.${ext}`;
  const path = join(root(), key);
  await mkdir(join(root(), key.split('/')[0]), { recursive: true });
  await writeFile(path, data);
  return key;
}

export function read(key: string) {
  const path = resolve(root(), key);
  if (!path.startsWith(root())) throw new Error('Ruta de almacenamiento inválida'); // defensa ante claves manipuladas
  return createReadStream(path);
}
