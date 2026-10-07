# 12 · Despliegue y operación

## Resumen

Una sola imagen Docker (`Dockerfile` en la raíz) contiene la API **y** el frontend compilado: la API sirve el frontend en el mismo origen, así las cookies y el CORS no dan problemas. Hacen falta tres piezas externas:

| Pieza | Para qué | Notas |
|---|---|---|
| **PostgreSQL gestionado** | Datos | Con copias automáticas del proveedor. |
| **Volumen persistente** montado en `/data/uploads` | Fotos y PDFs de las reparaciones | **Obligatorio** (ver «Adjuntos»). |
| **Proveedor SMTP** (Brevo, Resend, SES, Mailgun…) | Todos los correos | La API se niega a arrancar con `SMTP_HOST=localhost`. |

El contenedor, al arrancar: ajusta el dueño del volumen, aplica las migraciones pendientes (`prisma migrate deploy`) y lanza la API sin privilegios (usuario `node`). Cierra de forma ordenada con `SIGTERM`.

## Variables de entorno

Todo se configura por entorno; no hay secretos en el repositorio. En producción la API **no arranca** si algo de lo obligatorio es inseguro, y lo dice con un mensaje claro.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | sí | `postgresql://usuario:clave@host:5432/base` |
| `JWT_SECRET` | sí | Mínimo 32 caracteres aleatorios; no puede ser el valor de ejemplo. Generar: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `FRONTEND_URL` | sí | URL pública **https** de la aplicación (se usa en los enlaces de los correos). |
| `TRUST_PROXY` | sí | Nº de proxys delante de la API: `1` en la mayoría de PaaS, `0` si no hay. Sin él, el límite de intentos sería global y la IP auditada sería la del proxy. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | sí | Proveedor de correo. `EMAIL_FROM` p. ej. `Mi Taller <no-reply@mitaller.com>` (el dominio debe estar verificado en el proveedor: SPF/DKIM). |
| `UPLOAD_DIR` | — | Por defecto `/data/uploads` en la imagen. Debe ser el volumen persistente. |
| `PORT` | — | Por defecto `3000`; muchos PaaS lo inyectan. |
| `BUSINESS_NAME`, `BUSINESS_ADDRESS`, `BUSINESS_PHONE`, `RECEIPT_TERMS` | — | Datos del taller y texto del resguardo. |
| `DEFAULT_TAX_RATE` (21), `QUOTE_VALID_DAYS` (15), `APPROVAL_LINK_DAYS` (7) | — | Reglas de presupuestos. |
| `OVERDUE_DAYS` | — | Umbrales de «atrasada» por estado, p. ej. `EN_REPARACION=10,RECIBIDO=2` (ver RN-28). |

Para crear el primer administrador (solo la primera vez): `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` (≥ 12 caracteres, no de ejemplo) y ejecutar `node dist/seed.js` dentro del contenedor. Es idempotente y **nunca pisa** a un usuario existente. Después se pueden quitar esas variables.

## Pasos de despliegue (cualquier PaaS que construya desde un Dockerfile)

1. Crea la base PostgreSQL y copia su `DATABASE_URL`.
2. Crea el servicio desde este repositorio usando el `Dockerfile` de la raíz.
3. Define las variables de la tabla anterior.
4. **Monta un volumen persistente en `/data/uploads`** y configura **una sola instancia** (ver «Adjuntos»).
5. Health check: `GET /api/health` → `200 {"ok":true,"db":true,"storage":true}`; responde `503` si la base no contesta o la carpeta de adjuntos no es escribible (p. ej. el volumen no está montado).
6. Despliega. Abre `https://tu-dominio/`, ejecuta el seed del administrador y entra.
7. Configura el dominio y verifica en el proveedor de correo el dominio del remitente.
8. Programa las copias de seguridad (ver más abajo) y **haz una restauración de prueba**.

Notas por plataforma (comprueba siempre la documentación vigente de cada una; no se probaron aquí):

- **Railway:** crea un servicio desde el repo (detecta el Dockerfile), añade el plugin de PostgreSQL y un *Volume* con mount path `/data/uploads`. Si el volumen se monta como root, el arranque ya corrige el dueño. `TRUST_PROXY=1`.
- **Render:** *Web Service* tipo Docker + base PostgreSQL de Render + *Persistent Disk* en `/data/uploads` (requiere plan de pago y fuerza una sola instancia; los despliegues tienen un corte breve). `TRUST_PROXY=1`.
- **Fly.io:** `fly launch` (usa el Dockerfile), `fly volumes create uploads --size 1` y `[mounts] source="uploads" destination="/data/uploads"` en `fly.toml`, una sola máquina por volumen, `internal_port = 3000`, health check a `/api/health`. `TRUST_PROXY=1`.

**Validado localmente:** la imagen se construyó, se negó a arrancar con configuración insegura, arrancó con una segura (migraciones aplicadas, frontend servido, `/api/health` sano), el seed rechazó una contraseña débil, los adjuntos sobrevivieron a destruir y recrear el contenedor con el mismo volumen, y la API corre como usuario sin privilegios.

## Adjuntos (fotos y PDFs): léelo antes de desplegar

En un PaaS **el disco del contenedor es efímero**: se borra en cada despliegue y reinicio. Por eso `/data/uploads` **debe ser un volumen persistente**; si no, se pierden todos los adjuntos en el siguiente despliegue, y la base seguiría apuntando a archivos que ya no existen (el sistema responde `404` en esos casos y `/api/health` avisa si la carpeta no es escribible, pero no puede detectar que el volumen sea el equivocado).

Consecuencias del almacenamiento en disco:
- **Una sola instancia.** Un volumen se monta en una máquina; no se puede escalar horizontalmente.
- **Copia de seguridad propia** del volumen (el script lo incluye), además de las copias de la base.
- **Escape futuro:** el almacenamiento está detrás de una interfaz mínima (`backend/src/lib/storage.ts`: `save` y `read`). Pasar a S3/Cloudflare R2 es reimplementar esas dos funciones; la base solo guarda una clave. Conviene hacerlo si hace falta más de una instancia o si no se quiere depender del volumen.

## Copias de seguridad y restauración

**Qué respaldar (las dos cosas, juntas; una sin la otra no sirve):**
1. La base de datos PostgreSQL.
2. La carpeta de adjuntos (`/data/uploads`).

`scripts/backup.sh` hace ambas: `pg_dump` en formato custom + `tar.gz` de los adjuntos, con retención configurable. Necesita `pg_dump` (cliente de la misma versión mayor o superior que el servidor) y `tar`.

```sh
DATABASE_URL=postgresql://... UPLOAD_DIR=/data/uploads ./scripts/backup.sh ./backups 14
```

Frecuencia recomendada: **a diario**, copiando el resultado **fuera** del servidor (almacenamiento de objetos, otro proveedor). Además, activa las copias automáticas del PostgreSQL gestionado y las instantáneas del volumen si el proveedor las ofrece.

**Restaurar:**
```sh
# 1) Base de datos (en una base vacía)
pg_restore --no-owner --exit-on-error -d "postgresql://..." db-AAAAMMDD-HHMMSS.dump
# 2) Adjuntos: devolver el contenido al volumen
tar -xzf uploads-AAAAMMDD-HHMMSS.tar.gz -C /data      # recrea /data/uploads
```
Al arrancar, la API aplica las migraciones que falten. **Probado:** el script generó volcado y adjuntos con la retención pedida, y el volcado se restauró en una base nueva con exactamente los mismos datos y las 9 migraciones.

**Haz una restauración de prueba antes de salir a producción y repítela cada cierto tiempo:** una copia que nunca se probó no es una copia.

## Operación

- **Logs:** salida estándar del contenedor. Los errores 500 se registran con su traza; al cliente solo llega «Error interno».
- **Migraciones:** `prisma migrate deploy` en cada arranque (solo hacia adelante). Con varias instancias podrían competir; por eso se usa una sola. Para volver atrás se restaura una copia.
- **Correos fallidos:** se reintentan solos (5 intentos con espera creciente) y el ADMIN los ve en *Correos*. Los que llevan un enlace de un solo uso no conservan su cuerpo: la persona los vuelve a solicitar.
- **Auditoría:** el ADMIN la consulta en *Auditoría* (intentos de login fallidos, cambios de estado, decisiones de clientes con IP…).
- **Dependencias:** ejecutar `npm audit --omit=dev` en `backend/` y `frontend/` periódicamente. Aviso conocido y aceptado: la CLI de Prisma arrastra `deepmerge-ts` (DoS por objetos recursivos); solo se ejecuta al desplegar con archivos propios, sin entrada de usuarios.
- **Cuentas del personal:** se crean desde *Usuarios* (invitación por correo); para quitar un acceso se deshabilita en lugar de borrar.

## Lista de comprobación antes de salir a producción

- [ ] `JWT_SECRET` generado aleatoriamente, `FRONTEND_URL` en https, `TRUST_PROXY` definido, SMTP real.
- [ ] Volumen persistente montado en `/data/uploads` y una sola instancia. Subir una foto, redesplegar y comprobar que sigue ahí.
- [ ] `/api/health` responde `200` con `storage: true`.
- [ ] Administrador creado con una contraseña larga; variables de seed retiradas.
- [ ] Dominio del remitente verificado en el proveedor de correo; recibir un correo de prueba (alta de usuario).
- [ ] Copia de seguridad programada **y restauración probada**.
- [ ] Datos del taller (`BUSINESS_*`) y texto del resguardo revisados; imprimir un resguardo y un presupuesto.
- [ ] Recorrido completo con una reparación de prueba: recepción → presupuesto → aprobación del cliente → entrega.
- [ ] Probar las pantallas en un navegador y en un móvil real (no se pudo hacer durante el desarrollo).

## Desarrollo local

```sh
docker compose up -d                 # PostgreSQL (:5433) y Mailpit (UI :8025, SMTP :1025)
cd backend
cp .env.example .env                 # ajusta SEED_ADMIN_* si quieres
npm install
npx prisma migrate dev
npm run seed                         # roles, permisos y primer ADMIN
npm run dev                          # API en :3000
cd ../frontend && npm install && npm run dev   # app en :5173 (proxy a la API)
cd ../backend && npm test            # 230+ pruebas contra la base de desarrollo
```
