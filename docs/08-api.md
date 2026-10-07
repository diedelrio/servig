# 08 · API REST (prefijo `/api`)

## Auth
POST `/auth/register` · POST `/auth/verify-email` · POST `/auth/resend-verification` · POST `/auth/login` · POST `/auth/refresh` · POST `/auth/logout` · POST `/auth/forgot-password` · POST `/auth/reset-password` · GET `/auth/me`

## Usuarios (ADMIN)
GET `/users?search&role&status` · POST `/users` (crea e invita por email) · PATCH `/users/:id` (rol, estado; no sobre uno mismo) · POST `/users/:id/resend-invite`

## Clientes y herramientas
GET `/customers?search` · POST `/customers` · GET `/customers/:id` (ficha con herramientas y cuenta de portal; luego reparaciones y presupuestos) · PATCH `/customers/:id`
GET `/tools?customerId&search` · POST `/tools` · GET/PATCH `/tools/:id` (el dueño no se cambia). Sin borrado en el MVP.

## Reparaciones
GET `/repairs?search&status&customerId` · POST `/repairs` (recepción; el cliente se deriva de la herramienta) · GET `/repairs/:id` (con historial, adjuntos y datos del taller para el resguardo) · POST `/repairs/:id/transition` (Fase 5)
POST `/repairs/:id/attachments` (cuerpo binario crudo, cabecera `x-filename`; JPG/PNG/WebP/PDF ≤ 10 MB, validado por contenido) · GET `/repairs/:id/attachments/:attId`
El resguardo es la página `/repairs/:id/receipt` del frontend (imprimir o guardar como PDF desde el navegador).

## Diagnóstico y presupuestos (Fase 6)
POST `/repairs/:id/diagnosis` (TECNICO/ADMIN; entradas append-only, `visibleToCustomer` por defecto false)
GET `/repairs/:id/quote` (quote + versiones + config) · PUT `/repairs/:id/quote` (crea v1 o reemplaza las líneas del borrador; solo EN_REVISION; el servidor calcula los importes) · POST `/repairs/:id/quote/send` (congela la versión, pasa a PRESUPUESTO_PENDIENTE_APROBACION y envía el correo, todo en una transacción) · POST `/repairs/:id/quote/withdraw` {comment} (cancela la versión enviada y vuelve a EN_REVISION) · POST `/repairs/:id/quote/new-version` (copia las líneas tras rechazo, retiro o vencimiento)

## Aprobación del cliente (Fase 7)
Públicos, sin sesión (límite 60 / 15 min por IP):
GET `/public/quote-approval/:token` → vista del presupuesto y `state` (OPEN | DECIDED | WITHDRAWN | EXPIRED | REPLACED | LINK_EXPIRED); 404 si el token no existe. No expone email, teléfono ni dirección ni diagnósticos internos.
POST `/public/quote-approval/:token/decision` {decision: APPROVE | REJECT, comment?} → 409 con `code` (ALREADY_DECIDED, QUOTE_EXPIRED, QUOTE_WITHDRAWN, LINK_EXPIRED, LINK_REPLACED) si ya no procede.
Personal: POST `/repairs/:id/quote/resend-link` (emite enlace nuevo; el anterior deja de valer).
El portal (Fase 9) usará el mismo núcleo `decideQuote` con origen CUSTOMER_PORTAL.

## Repuestos (Fase 8)
GET `/repairs/:id/spare-parts` (lista + resumen: pendientes, sin instalar, totales sin cancelados) · POST `/repairs/:id/spare-parts` · PATCH `/spare-parts/:id` (solo mientras no esté INSTALADO/CANCELADO) · POST `/spare-parts/:id/status` {to, date?}
Permisos: `part:read` (ADMIN, RECEPCION, TECNICO) y `part:write` (ADMIN, TECNICO).

## Portal cliente (Fase 9)
Requiere sesión de una cuenta CLIENTE vinculada a un cliente (403 `NO_CUSTOMER_LINK` si no lo está; 403 para el personal). Todo se filtra por el cliente de la sesión y lo ajeno responde 404.
GET `/portal/repairs` (activas e historial; `pendingQuote`) · GET `/portal/repairs/:id` (estado, línea de tiempo solo con estado y fecha, diagnósticos visibles, presupuesto vigente enviado con `canDecide`, repuestos sin importes, documentos visibles, datos del resguardo) · GET `/portal/repairs/:id/attachments/:attId` (solo los marcados visibles) · POST `/portal/repairs/:id/quote/decision` {decision, comment?} (mismo núcleo que el enlace, origen CUSTOMER_PORTAL con el usuario).
Personal: PATCH `/repairs/:id/attachments/:attId` {visibleToCustomer} (permiso `repair:attach`).

## Administración (Fase 10, solo ADMIN)
GET `/audit?entity&entityId&action&userId&from&to&before&limit` (cursor por id, hasta 200 por página; `to` incluye todo el día) · GET `/audit/actions`
GET `/email-logs?status&type&to&before&limit` (nunca devuelve el cuerpo; `canRetry` indica si se puede reenviar) · POST `/email-logs/:id/retry`

## Dashboard y búsqueda (Fase 11)
GET `/dashboard` (permiso `dashboard:read`: ADMIN, RECEPCION, TECNICO) → `counts` (received, inReview, pendingQuote, awaitingApproval, approved, awaitingParts, inRepair, readyForPickup, overdue, rejected, repaired), `overdue` (hasta 50, las más pasadas del umbral primero) y `thresholds`.
GET `/search?q=` (requiere leer clientes, herramientas y reparaciones) → hasta 8 clientes, reparaciones y herramientas; con menos de 2 caracteres devuelve vacío.
GET `/repairs?filter=overdue|pendingQuote` se combina con `status` y `search`: es a donde llevan los contadores.
