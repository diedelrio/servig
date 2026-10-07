# 09 · Backlog MVP

Formato: EPIC → FEATURE → HISTORIA → TASKS. Prioridad MoSCoW. Criterios en Given/When/Then.

## EPIC 0 · Setup (Fase 0) — MUST
**HU-0.1** Como desarrollador quiero un monorepo con DB y mail locales para trabajar.
- Given Docker instalado, When `docker compose up -d`, Then PostgreSQL y Mailpit responden.
- Given `.env` configurado, When `npm run dev`, Then backend `/api/health` y frontend cargan.
- Tasks: git, compose, Prisma, Express, Vite, servicio de email base.

## EPIC 1 · Autenticación (Fase 1) — MUST
**HU-1.1 Registro.** Como visitante quiero crear una cuenta para usar el portal. Dep: HU-0.1.
- Given email nuevo y contraseña válida, When me registro, Then el usuario queda PENDING_EMAIL_VERIFICATION y recibo email.
- Given email existente, When me registro, Then respuesta genérica sin revelar existencia.
- Given contraseña débil, When me registro, Then error de validación.

**HU-1.2 Confirmación de email.**
- Given token válido, When abro el enlace, Then cuenta ACTIVE, token invalidado, `emailVerifiedAt` guardado.
- Given token vencido o usado, When abro el enlace, Then error y opción de reenvío.
- Given reenvío reciente (<60 s), When reenvío, Then rechazo por límite.

**HU-1.3 Login/Sesión.**
- Given cuenta ACTIVE y credenciales correctas, When inicio sesión, Then recibo access + refresh cookie.
- Given credenciales incorrectas o cuenta inexistente, Then mismo mensaje genérico.
- Given cuenta pendiente, Then no puedo iniciar sesión.

**HU-1.4 Recuperación/Cambio de contraseña.**
- Given cualquier email, When solicito recuperación, Then mensaje genérico.
- Given token válido, When defino nueva contraseña, Then se guarda Argon2id, token invalidado, sesiones revocadas, email de confirmación.

## EPIC 2 · Usuarios y roles (Fase 2) — MUST
**HU-2.1** Como ADMIN quiero crear usuarios de personal y asignar roles.
- Given soy ADMIN, When creo un TECNICO, Then recibe email de activación.
- Given no soy ADMIN, When intento gestionar usuarios, Then 403.

## EPIC 3 · Clientes y herramientas (Fase 3) — MUST
**HU-3.1** CRUD clientes (RECEPCION/ADMIN). **HU-3.2** CRUD herramientas con garantía.
- Given un cliente, When abro su ficha, Then veo herramientas, reparaciones, presupuestos, documentos.

## EPIC 4 · Recepción (Fase 4) — MUST
**HU-4.1** Crear reparación con número único y adjuntos. **HU-4.2** Resguardo imprimible/PDF.
- Given cliente y herramienta, When recepciono, Then número REP-AAAA-NNNNNN único, estado RECIBIDO, email "herramienta recibida".

## EPIC 5 · Workflow (Fase 5) — MUST
**HU-5.1** Transiciones validadas con historial inmutable.
- Given transición no permitida para mi rol/estado, Then 409/403.
- Given transición válida, Then se inserta historial y auditoría en una transacción.

## EPIC 6 · Diagnóstico y presupuestos (Fase 6) — MUST
**HU-6.1** Diagnóstico con visibilidad al cliente. **HU-6.2** Presupuesto con ítems, IVA, total, versionado.
- Given presupuesto ENVIADO, When lo edito, Then se crea nueva versión y la anterior queda intacta.

## EPIC 7 · Aprobación digital (Fase 7) — MUST
**HU-7.1** Cliente aprueba/rechaza por enlace o portal.
- Given requiresQuote y sin aprobación, When intento pasar a EN_REPARACION, Then el backend rechaza.
- Given enlace válido, When apruebo, Then se registra decisión, versión, fecha, IP, origen y estado PRESUPUESTO_APROBADO.

## EPIC 8 · Repuestos y reparación (Fase 8) — MUST
**HU-8.1** Gestionar repuestos por reparación con estados y fechas.

## EPIC 9 · Portal cliente (Fase 9) — MUST
**HU-9.1** Cliente ve sus reparaciones, timeline, presupuesto, documentos.
- Given soy CLIENTE, When pido una reparación ajena, Then 404.

## EPIC 10 · Emails, documentos y auditoría (Fase 10) — MUST
**HU-10.1** Todos los emails transaccionales con EmailLog y reintentos. **HU-10.2** Vista de auditoría (ADMIN).

## EPIC 11 · Dashboard y búsqueda (Fase 11)
**HU-11.1** Dashboard con contadores y atrasadas — MUST. **HU-11.2** Búsqueda — SHOULD. **HU-11.3** Job de vencimiento de presupuestos — SHOULD.

## EPIC 12 · Calidad y despliegue (Fase 12) — MUST
Tests de reglas críticas, revisión de seguridad, guía de despliegue.

## COULD (futuro)
Stock real, WhatsApp/SMS, firma manuscrita, 2FA, UI de permisos, reportes.
