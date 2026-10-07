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
POST `/repairs/:id/spare-parts` · PATCH `/repair-spare-parts/:id` (fases posteriores)

## Diagnóstico y presupuestos (Fase 6)
POST `/repairs/:id/diagnosis` (TECNICO/ADMIN; entradas append-only, `visibleToCustomer` por defecto false)
GET `/repairs/:id/quote` (quote + versiones + config) · PUT `/repairs/:id/quote` (crea v1 o reemplaza las líneas del borrador; solo EN_REVISION; el servidor calcula los importes) · POST `/repairs/:id/quote/send` (congela la versión, pasa a PRESUPUESTO_PENDIENTE_APROBACION y envía el correo, todo en una transacción) · POST `/repairs/:id/quote/withdraw` {comment} (cancela la versión enviada y vuelve a EN_REVISION) · POST `/repairs/:id/quote/new-version` (copia las líneas tras rechazo, retiro o vencimiento)

## Aprobación
GET `/public/quote-approval/:token` · POST `/public/quote-approval/:token/decision` · POST `/portal/quotes/:id/decision`

## Portal cliente
GET `/portal/repairs` · GET `/portal/repairs/:id`

## Otros
GET `/dashboard` · GET `/search?q=` · GET `/audit` (ADMIN) · GET `/email-logs` (ADMIN)
