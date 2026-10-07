# 08 · API REST (prefijo `/api`)

## Auth
POST `/auth/register` · POST `/auth/verify-email` · POST `/auth/resend-verification` · POST `/auth/login` · POST `/auth/refresh` · POST `/auth/logout` · POST `/auth/forgot-password` · POST `/auth/reset-password` · GET `/auth/me`

## Usuarios (ADMIN)
GET/POST `/users` · PATCH `/users/:id` (rol, estado)

## Clientes y herramientas
CRUD `/customers`, GET `/customers/:id` (con herramientas, reparaciones, presupuestos) · CRUD `/tools`

## Reparaciones
GET/POST `/repairs` · GET `/repairs/:id` · POST `/repairs/:id/transition` · GET `/repairs/:id/receipt` (resguardo) · POST/GET `/repairs/:id/attachments` · POST `/repairs/:id/diagnosis` · POST `/repairs/:id/spare-parts` · PATCH `/repair-spare-parts/:id`

## Presupuestos
POST `/repairs/:id/quotes` · PUT `/quotes/:id` (borrador) · POST `/quotes/:id/send` · POST `/quotes/:id/new-version`

## Aprobación
GET `/public/quote-approval/:token` · POST `/public/quote-approval/:token/decision` · POST `/portal/quotes/:id/decision`

## Portal cliente
GET `/portal/repairs` · GET `/portal/repairs/:id`

## Otros
GET `/dashboard` · GET `/search?q=` · GET `/audit` (ADMIN) · GET `/email-logs` (ADMIN)
