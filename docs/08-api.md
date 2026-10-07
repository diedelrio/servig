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
POST `/repairs/:id/diagnosis` · POST `/repairs/:id/spare-parts` · PATCH `/repair-spare-parts/:id` (fases posteriores)

## Presupuestos
POST `/repairs/:id/quotes` · PUT `/quotes/:id` (borrador) · POST `/quotes/:id/send` · POST `/quotes/:id/new-version`

## Aprobación
GET `/public/quote-approval/:token` · POST `/public/quote-approval/:token/decision` · POST `/portal/quotes/:id/decision`

## Portal cliente
GET `/portal/repairs` · GET `/portal/repairs/:id`

## Otros
GET `/dashboard` · GET `/search?q=` · GET `/audit` (ADMIN) · GET `/email-logs` (ADMIN)
