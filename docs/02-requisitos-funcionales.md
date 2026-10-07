# 02 · Requisitos funcionales

| ID | Requisito | Prioridad |
|---|---|---|
| RF-01 | Registro (nombre, apellido, email único, contraseña + confirmación) | MUST |
| RF-02 | Confirmación de email con token de un solo uso y vencimiento; reenvío con límite | MUST |
| RF-03 | Login genérico en errores; sesión access+refresh | MUST |
| RF-04 | Recuperación y cambio de contraseña; invalida sesiones | MUST |
| RF-05 | Administración de usuarios y roles (solo ADMIN) | MUST |
| RF-06 | CRUD clientes con vista de herramientas, reparaciones, presupuestos, documentos | MUST |
| RF-07 | CRUD herramientas con garantía y vencimiento | MUST |
| RF-08 | Recepción: reparación con número REP-AAAA-NNNNNN, adjuntos, resguardo imprimible | MUST |
| RF-09 | Workflow de estados con historial inmutable | MUST |
| RF-10 | Diagnóstico (con flag visible al cliente) | MUST |
| RF-11 | Presupuestos con ítems, impuestos, total y versionado | MUST |
| RF-12 | Aprobación/rechazo por enlace seguro o por portal, con IP y origen | MUST |
| RF-13 | Repuestos por reparación con estados | MUST |
| RF-14 | Portal cliente (estado, timeline, presupuesto, documentos) | MUST |
| RF-15 | Emails transaccionales (auth + reparaciones) con EmailLog | MUST |
| RF-16 | Auditoría de operaciones importantes | MUST |
| RF-17 | Dashboard del taller con contadores y atrasadas | MUST |
| RF-18 | Búsqueda de reparaciones/clientes | SHOULD |
| RF-19 | Vencimiento automático de presupuestos (job) | SHOULD |
