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
