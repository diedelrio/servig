# 04 · Workflow de reparaciones

## Transiciones permitidas

| Desde | Hacia | Roles |
|---|---|---|
| RECIBIDO | EN_REVISION | TECNICO, ADMIN |
| EN_REVISION | PRESUPUESTO_PENDIENTE_APROBACION (al enviar presupuesto) | TECNICO, ADMIN |
| EN_REVISION | EN_REPARACION (solo si `requiresQuote=false`) | TECNICO, ADMIN |
| PRESUPUESTO_PENDIENTE_APROBACION | PRESUPUESTO_APROBADO / PRESUPUESTO_RECHAZADO | CLIENTE (enlace/portal), sistema |
| PRESUPUESTO_APROBADO | PEDIDO_REPUESTOS_MARCA | TECNICO, ADMIN |
| PRESUPUESTO_APROBADO | EN_REPARACION | TECNICO, ADMIN |
| PEDIDO_REPUESTOS_MARCA | EN_REPARACION (repuestos recibidos) | TECNICO, ADMIN |
| PRESUPUESTO_RECHAZADO | EN_REVISION (nueva versión) / LISTO_PARA_RETIRAR (devolver sin reparar) | TECNICO, ADMIN |
| EN_REPARACION | REPARADO | TECNICO, ADMIN |
| REPARADO | LISTO_PARA_RETIRAR | TECNICO, RECEPCION, ADMIN |
| LISTO_PARA_RETIRAR | ENTREGADO | RECEPCION, ADMIN |
| cualquiera no final | CANCELADO | ADMIN, RECEPCION |

Estados finales: ENTREGADO, CANCELADO.

## Historial
Cada transición inserta una fila en `RepairStatusHistory`: estado anterior, nuevo, fecha/hora, usuario, comentario, origen (STAFF | CUSTOMER_LINK | CUSTOMER_PORTAL | SYSTEM). Solo INSERT.

## Estados de Quote
BORRADOR → ENVIADO → APROBADO | RECHAZADO | VENCIDO; CANCELADO desde BORRADOR/ENVIADO.

## Estados de repuesto
NECESARIO → SOLICITADO → PEDIDO_A_MARCA → RECIBIDO → INSTALADO; CANCELADO.

## Implementación (Fase 5)
- Fuente de verdad: `backend/src/modules/repairs/workflow.ts` (`RULES`). Toda transición pasa por `transitionRepair()`: valida la matriz, el rol (leído de la BD), los comentarios obligatorios y la regla RN-01, y en una transacción cambia el estado (condicionado al estado leído, ante concurrencia el segundo recibe 409) e inserta el historial. Después audita y envía los correos.
- Transiciones **internas** (`PRESUPUESTO_PENDIENTE_APROBACION`, `PRESUPUESTO_APROBADO`, `PRESUPUESTO_RECHAZADO`): solo las dispara el código del envío de presupuesto (Fase 6) y de la decisión del cliente (Fase 7). El endpoint `POST /repairs/:id/transition` las rechaza (409) incluso para ADMIN. Así RN-01 no depende del frontend ni de la buena voluntad del personal.
- Comentario obligatorio: cancelar y "devolver sin reparar".
- Correos al cliente: `REPARADO` (reparación finalizada) y `LISTO_PARA_RETIRAR`.
- `GET /repairs/:id` devuelve `allowedTransitions` según el rol, que alimenta los botones del frontend.
- Pendiente para la Fase 7: la transición a `EN_REPARACION` desde `PRESUPUESTO_APROBADO` se apoya en que ese estado solo lo fija la aprobación; al existir `QuoteApproval` se añadirá la comprobación explícita de la aprobación de la última versión.
