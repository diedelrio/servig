# 05 · Autenticación y seguridad

## Flujos
Registro (PENDING_EMAIL_VERIFICATION) → email con `/verify-email?token=` → ACTIVE → login → sesión → `/forgot-password` → `/reset-password?token=` → nueva contraseña.

## Sesión
- Access JWT de 15 min (header `Authorization: Bearer`, en memoria del frontend).
- Refresh token opaco rotativo, cookie httpOnly + SameSite=Lax + Secure en prod, hash guardado en `RefreshToken`.
- Cambio/reset de contraseña revoca todos los refresh tokens del usuario.

## Controles
- Argon2id (librería `argon2`).
- Tokens de 32 bytes aleatorios (`crypto.randomBytes`), SHA-256 en BD, un solo uso, vencimiento.
- Mensajes genéricos en login y recuperación (no enumeración de usuarios).
- Rate limiting en login, registro, reenvío y recuperación; cooldown 60 s en emails.
- Validación de inputs con Zod en cada endpoint.
- Helmet, CORS restringido a `FRONTEND_URL`.
- Autorización por rol/permiso en middleware; el cliente solo accede a sus datos.
- Secretos solo por `.env`.

## Permisos
Modelo Role ↔ Permission en BD (`recurso:acción`), asignación por seed; middleware `requirePermission('repair:transition')`.

## Auditoría
`AuditLog`: usuario, acción, entidad, id, fecha, datos relevantes.

## Enlace de aprobación del presupuesto (Fase 7)
- Token de 32 bytes aleatorios; en la base solo su SHA-256 (`QuoteLinkToken`). Atado a una versión concreta.
- Vence a los `APPROVAL_LINK_DAYS` (7) sin pasar de `validUntil` del presupuesto. Un solo uso; reenviar emite uno nuevo e invalida el anterior.
- La decisión es atómica: consume el enlace, cierra la versión, guarda `QuoteApproval` (decisión, fecha, origen, IP, navegador, comentario) y cambia el estado de la reparación en una transacción. Ante decisiones simultáneas gana una.
- Detrás de un proxy hay que definir `TRUST_PROXY` para registrar la IP real.
- RN-01 comprobada explícitamente: pasar a EN_REPARACION con presupuesto requerido exige `QuoteApproval = APROBADO` de la última versión, no solo el estado.

## Correos y auditoría (Fase 10)
- **Correos con enlace de un solo uso** (`AUTH_VERIFY_EMAIL`, `AUTH_PASSWORD_RESET`, `AUTH_INVITE`, `QUOTE_AVAILABLE`): se envían, pero su **cuerpo no se guarda** en `EmailLog`, para que nadie con acceso al registro pueda usar los enlaces. Si fallan, la persona los vuelve a solicitar. El resto guarda el cuerpo para poder reintentar.
- **Reintentos:** 3 intentos inmediatos al enviar (1 s y 3 s de espera) y, en segundo plano cada 5 min, hasta 5 intentos en total con espera creciente (5, 10, 20… min). El ADMIN puede reintentar a mano. La API del registro nunca devuelve el cuerpo.
- **Proveedor desacoplado:** `Transport` en `lib/email.ts`; cambiar de SMTP a una API es implementar `send()` y llamar a `setTransport()`.
- **Auditoría de autenticación:** `LOGIN`, `LOGIN_FAILED` (motivo: unknown_user, bad_password, disabled, unverified; con email intentado e IP, nunca la contraseña), `REFRESH_REUSE_DETECTED`, `REGISTER`, `EMAIL_VERIFIED`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_CHANGED`.
- **IP en toda la auditoría:** se toma de la petición en curso (`AsyncLocalStorage`), sin pasarla a mano. Detrás de un proxy hay que definir `TRUST_PROXY`.
- Argon2id usa los parámetros por defecto en producción; en tests se abaratan (`NODE_ENV=test`) solo para que la suite no se sature.

## Revisión de seguridad (Fase 12)

Revisión independiente del backend (un agente de solo lectura con instrucciones de buscar fallos explotables) más revisión propia. Resultado: **sin fallos críticos ni altos**; la regla crítica (RN-01) se sostiene. Hallazgos y qué se hizo:

| Hallazgo | Sev. | Resolución |
|---|---|---|
| **Pre-secuestro de cuenta:** registrar el email de otra persona con una contraseña propia dejaba la cuenta activa con esa contraseña cuando la víctima hacía clic, y la vinculaba a su ficha de cliente. | Media | Activar exige el **enlace del correo y la contraseña del registro** (`WRONG_PASSWORD` sin gastar el enlace). Quien olvidó su contraseña usa «¿Olvidaste tu contraseña?», que ahora también sirve para cuentas sin confirmar y las activa. |
| **Enumeración de emails por tiempos** (registro, recuperación y reenvío tardaban distinto si el usuario existía). | Media | Se calcula el mismo hash en ambas ramas y el correo sale **en segundo plano** (`defer`). |
| **`TRUST_PROXY` opcional:** tras un balanceador el límite de intentos era global y la IP auditada falsa. | Media | En producción es **obligatorio** declararlo; la API no arranca sin él. |
| **Salto de la aprobación por garantía:** un recepcionista podía crear la reparación con `requiresQuote=false` solo declarando «en garantía». | Media | Exige garantía **vigente registrada** en la herramienta; sin ella solo un ADMIN, y queda anotado en la auditoría (`quoteWaived`). |
| Carrera al guardar y enviar un borrador a la vez (podían reescribirse líneas de una versión ya enviada; el correo podía anunciar otro total). | Baja | Bloqueo de fila condicionado a `BORRADOR`; el correo y la auditoría usan lo realmente congelado. |
| Sin límite en `verify-email`/`refresh`; login solo por IP. | Baja | Límites propios y **contador por cuenta** en el login (los accesos correctos no cuentan). |
| Reutilización de refresh por dos pestañas cerraba todas las sesiones. | Baja | Tolerancia de 10 s; el logout borra el token (reutilizarlo después no dispara el cierre masivo). |
| `JWT_SECRET` sin mínimo y con valor de ejemplo válido; `REFRESH_SECRET` sin uso. | Baja | En producción: ≥ 32 caracteres, no de ejemplo, https; `REFRESH_SECRET` eliminado. |
| 500 evitables: `x-filename` mal codificado, importes que desbordaban `Decimal(12,2)`, archivo ausente en disco. | Baja | 400/404 limpios; límites por línea y comprobación del total. |
| JWT: algoritmo no fijado. | — | `HS256` fijado al firmar y verificar (rechaza `none` y otros). |

Otras defensas añadidas: cabeceras CSP estrictas (sin scripts en línea, sin iframes), `Content-Security-Policy: sandbox` en cada adjunto descargado, límite general por IP, `/api/health` real (base y almacenamiento), rechazo del carácter nulo en cualquier entrada, y el seed no crea administradores con contraseñas débiles en producción.

**Riesgos aceptados / pendientes (conscientes):**
- La CLI de Prisma arrastra `deepmerge-ts` con un aviso de DoS; solo corre al desplegar con archivos propios.
- El bloqueo por cuenta (10 fallos / 15 min) permite que un atacante bloquee temporalmente el login de una víctima concreta; se prefirió a permitir fuerza bruta distribuida.
- El historial de estados y la auditoría son «solo inserción» por diseño de la aplicación, no por restricción de la base de datos (un trigger lo garantizaría a nivel de motor).
- Un JWT de acceso sigue siendo válido hasta 15 min tras deshabilitar a un usuario, pero toda ruta del personal y del portal relee su estado en la base, así que no tiene efecto.
- Adjuntos en disco: ver la advertencia de despliegue (volumen persistente, una sola instancia).
