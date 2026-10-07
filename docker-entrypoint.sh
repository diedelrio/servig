#!/bin/sh
# Arranque del contenedor de producción.
#  1. Deja la carpeta de adjuntos (el volumen persistente) con el dueño correcto: los volúmenes de los PaaS suelen montarse como root.
#  2. Aplica las migraciones pendientes de la base de datos.
#  3. Arranca la API sin privilegios (usuario «node»).
set -e

UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
mkdir -p "$UPLOAD_DIR"
# Solo se recorre el árbol si la raíz no es ya de «node»: un volumen grande no retrasa cada arranque.
if [ "$(stat -c %U "$UPLOAD_DIR")" != "node" ]; then
  chown -R node:node "$UPLOAD_DIR"
fi

drop() { setpriv --reuid=node --regid=node --init-groups "$@"; }

echo "[servig] aplicando migraciones…"
drop node_modules/.bin/prisma migrate deploy

echo "[servig] arrancando la API en el puerto ${PORT:-3000}"
exec setpriv --reuid=node --regid=node --init-groups node dist/server.js
