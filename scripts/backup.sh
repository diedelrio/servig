#!/bin/sh
# Copia de seguridad: base de datos (pg_dump, formato custom) + adjuntos (tar.gz). Ambas partes juntas: una sin la otra no sirve.
#
# Uso:   DATABASE_URL=postgresql://... UPLOAD_DIR=/data/uploads ./scripts/backup.sh [carpeta_destino] [copias_a_conservar]
# Ej.:   ./scripts/backup.sh ./backups 14      (programar a diario con cron / tarea programada del PaaS)
#
# Requiere pg_dump (cliente de PostgreSQL de la misma versión mayor o superior que el servidor) y tar.
set -eu

: "${DATABASE_URL:?Falta DATABASE_URL}"
: "${UPLOAD_DIR:?Falta UPLOAD_DIR}"
OUT="${1:-./backups}"
KEEP="${2:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$OUT"

# Prisma admite parámetros en la URL (?schema=public…) que libpq/pg_dump no entienden: se quitan.
PG_URL="${DATABASE_URL%%\?*}"

echo "[backup] base de datos → $OUT/db-$STAMP.dump"
pg_dump --format=custom --no-owner --file="$OUT/db-$STAMP.dump" "$PG_URL"

echo "[backup] adjuntos      → $OUT/uploads-$STAMP.tar.gz"
tar -czf "$OUT/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"

# Retención: se conservan las últimas $KEEP copias de cada tipo.
for kind in db uploads; do
  ls -1t "$OUT"/"$kind"-* 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    echo "[backup] borrando copia antigua: $old"
    rm -f "$old"
  done
done

echo "[backup] listo. Para restaurar: ver docs/12-deployment.md"
