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
