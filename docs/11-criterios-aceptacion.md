# 11 · Criterios de aceptación globales

El MVP se acepta cuando:

1. Un cliente nuevo se registra, confirma email y entra al portal.
2. Un flujo completo RECIBIDO → ENTREGADO se ejecuta con los tres roles de personal y un cliente.
3. **Ninguna** llamada directa a la API consigue pasar a EN_REPARACION sin presupuesto aprobado (si `requiresQuote`).
4. El historial de estados y las decisiones de aprobación son consultables y no modificables.
5. Todos los emails de `docs/05` y de reparaciones se envían y quedan en EmailLog (con error si falló).
6. Login y recuperación no revelan si un email existe.
7. Un CLIENTE no puede ver datos de otros clientes.
8. Contraseñas con Argon2id; tokens solo como hash; sin secretos en el repo.
9. El resguardo se imprime/guarda como PDF desde el navegador.
10. Dashboard muestra los contadores definidos.
11. Tests automáticos cubren: workflow, regla RN-01, tokens de un solo uso, autorización por rol.

## Cómo se verifica cada criterio

El recorrido integrado está en `backend/tests/acceptance.test.ts` (un relato de punta a punta); el detalle está en las pruebas por módulo.

| # | Criterio | Dónde se comprueba |
|---|---|---|
| 1 | Registro, confirmación y portal | `acceptance` (1-2), `auth`, `portal` |
| 2 | Flujo RECIBIDO → ENTREGADO con los tres roles y un cliente | `acceptance` (2), `workflow` |
| 3 | Imposible reparar sin aprobación | `acceptance` (3), `workflow` (121 pares de estados), `approval`, `quotes` |
| 4 | Historial y decisiones consultables y no modificables | `acceptance` (4), `workflow`, `audit` |
| 5 | Todos los correos se envían y quedan en `EmailLog` | `acceptance` (5), `emails` |
| 6 | Login y recuperación no revelan si un email existe | `acceptance` (6-8), `auth`, `security` |
| 7 | Un cliente no ve datos de otro | `acceptance`, `portal` |
| 8 | Argon2id, tokens solo como hash, sin secretos en el repo | `acceptance`, `security` |
| 9 | Resguardo imprimible | datos en `acceptance` (9); la impresión se prueba a mano desde el navegador |
| 10 | Dashboard con los contadores | `acceptance`, `dashboard` |
| 11 | Pruebas de workflow, RN-01, tokens y roles | `acceptance` (11) + toda la batería |

**Pendiente de verificación manual (no automatizable aquí):** el aspecto y el comportamiento de las pantallas en un navegador y en un móvil real, y la impresión/«Guardar como PDF» del resguardo y del presupuesto.
