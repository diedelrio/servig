# Contexto para continuar en una sesión nueva

Resumen de todo lo hecho hasta ahora (a 12-oct-2026, último commit `2e5a18d`). Pásalo al asistente al empezar la sesión nueva
junto con la petición del momento. Fuente de verdad del detalle: `docs/` (en especial `03-reglas-negocio.md`, `08-api.md`, `12-deployment.md`).

## 1. Qué es
Aplicación web de gestión de un **taller de reparación de herramientas** (Servi-González, Valencia). Repo: https://github.com/diedelrio/servig (rama `master`).
Web institucional estática (repo aparte): https://github.com/diedelrio/servigonzalez → publicada en https://servigonzalez.onrender.com.

**Regla crítica:** ninguna reparación que requiera presupuesto empieza sin la aprobación explícita del cliente, y se valida en el backend (RN-01).
Aprobar o rechazar un presupuesto **exige usuario de la app** (RN-35); el enlace del correo solo permite verlo.

## 2. Stack y estructura
- Monorepo: `backend/` (Node 24, Express 5, Prisma 6.19.3, PostgreSQL 16, Zod 4, vitest, JWT + Argon2id), `frontend/` (React 19, Vite 8, react-router 7, axios), `docs/`, `Dockerfile` (una imagen sirve API + frontend), `docker-compose.yml` (db en el puerto **5433** + Mailpit).
- Roles: `ADMIN`, `RECEPCION`, `TECNICO`, `CLIENTE`. Permisos `recurso:accion` en base de datos (`backend/src/lib/seedRoles.ts`), leídos en cada petición.
- Un único punto cambia el estado de una reparación: `transitionRepair()` en `backend/src/modules/repairs/workflow.ts` (matriz `RULES`).
- Estados: `SOLICITADA` (pedido del cliente, la herramienta aún no llegó) → `RECIBIDO` → `EN_REVISION` → `PRESUPUESTO_PENDIENTE_APROBACION` → `PRESUPUESTO_APROBADO`/`PRESUPUESTO_RECHAZADO` → `PEDIDO_REPUESTOS_MARCA` → `EN_REPARACION` → `REPARADO` → `LISTO_PARA_RETIRAR` → `ENTREGADO` (+ `CANCELADO`).
- Parámetros editables en base (`backend/src/lib/settings.ts`, tabla `Settings`): precedencia base > variable de entorno > valor por defecto; caché de 10 s. Dos secciones: *Parámetros* (IVA, validez de presupuesto, días de atraso por estado, datos del taller) y *Sistema* (sesión, enlaces, adjuntos, numeración del resguardo).
- Catálogos administrables: `Brand`, `ToolType`, `ToolModel` (modelo = marca + tipo). La herramienta guarda además copia en texto (`type/brand/model`) y `modelId` opcional.
- Módulos backend: `auth, users, customers, repairs, quotes, spareparts, portal, public, catalogs, config, dashboard, admin`.

## 3. Qué hay construido (todo con tests: 296 pasando, 17 archivos)
Fases 0–12 del `mvp.md` más lo posterior:
- Portal del **taller** (ADMIN/RECEPCION/TECNICO): inicio con contadores, reparaciones, clientes/herramientas, presupuestos con versiones, repuestos, adjuntos, resguardo imprimible, usuarios, registro de correos, auditoría, búsqueda global.
- **Configuración** (solo ADMIN): menú propio con *Catálogos*, *Parámetros* y *Sistema*, en grilla con ver / editar / restablecer.
- Portal del **cliente**: inicio con 5 tarjetas (abiertas, presupuestos por aprobar, aprobados, en reparación, para retirar) que llevan a la grilla filtrada; "Pedir una reparación" (estado `SOLICITADA`); cancelar solicitud; aprobar/rechazar presupuesto; perfil.
- **Web pública sin cuenta**: `/solicitar` (pide la reparación; nada se crea hasta confirmar desde el correo), `/solicitud/confirmar`, `/consulta` (nº de resguardo + email → enlace temporal de solo lectura).
- **Nº de resguardo del sistema contable** (`Repair.accountingReceipt`): lo carga a mano ADMIN/RECEPCION (permiso `repair:accounting`); se busca y se audita; vale también en la consulta anónima.
- Tema alineado a servigonzalez.onrender.com (naranja `#ff6600`, cabeceras negras, Inter + Montserrat) y logo "SG" (`frontend/public/logo.png`, `favicon.png`).
- Endurecimiento de producción: validación de variables (`productionProblems()`), `TRUST_PROXY` obligatorio, CSP, auditoría con IP, correos sin cuerpo guardado para los que llevan enlace.

## 4. Cómo levantarlo (desarrollo)
```
docker compose up -d                       # db (5433) + Mailpit (http://localhost:8025)
cd backend && cp .env.example .env         # cambiar JWT_SECRET (>= 32 caracteres)
npm install && npx prisma migrate dev && npm run seed && npm run dev   # API http://localhost:3000
cd frontend && npm install && npm run dev                              # http://localhost:5173
```
- Tests: `cd backend && npm test` (usa la base de desarrollo, en paralelo; cada archivo borra solo sus datos con `tests/cleanup.ts`). Typecheck: `npm run typecheck`. Frontend: `npm run build` y `npx oxlint src`.
- Credenciales **solo de desarrollo**: admin `admin@servig.local` / `Admin12345!x`; cliente demo `cliente.demo@servig.local` / `Cliente12345!x`. En la base de otra máquina solo existirá el admin del seed.
- Los correos de desarrollo NO salen: llegan a Mailpit (http://localhost:8025).

## 5. Decisiones tomadas (no re-discutir salvo que el dueño lo pida)
- Solo el cliente aprueba presupuestos, sin excepciones; ahora con usuario (RN-35). El personal no decide por él.
- Umbral de "atrasada" por estado, configurable (RN-28/RN-30).
- Adjuntos en disco del servidor con copia de seguridad (`scripts/backup.sh`); despliegue previsto en PaaS gestionado (Railway / Render / Fly.io).
- Estado nuevo `SOLICITADA` para los pedidos del cliente (en vez de usar `RECIBIDO`); siempre con presupuesto obligatorio.
- Solicitud web: confirmación por correo antes de crear nada (evita ensuciar el portal de terceros); respuestas genéricas para no revelar qué reparaciones/correos existen.
- Web institucional y aplicación como **dos sitios enlazados** (p. ej. `www.` y `app.`), no fusionados.

## 6. Pendiente / siguientes pasos
1. **Integrar la web institucional** con la app: se generó un prompt para que una IA edite el `index.html` del repo `servigonzalez` (botones "Área de clientes", "Pedir una reparación", "Consultar mi reparación", footer; sustituir el formulario de contacto que no envía nada). Falta fijar el dominio definitivo de la app (`APP_URL`).
2. **Desplegar** en el PaaS elegido (ver `docs/12-deployment.md`): `FRONTEND_URL` = URL https de la app; SMTP real con SPF/DKIM; volumen para `/data/uploads`; `TRUST_PROXY` explícito.
3. Probar las pantallas en un móvil real y en distintos navegadores; elegir si los adjuntos pasan a almacenamiento tipo S3.
4. Ideas aparte (no pedidas): varios impuestos con nombre en vez de un IVA único; quitar los endpoints de solo lectura de estados/roles/tablas del backend (la pantalla ya no los usa); mostrar el nº contable en el resguardo impreso; exportación/importación de datos de desarrollo entre equipos.

## 7. Trampas conocidas (ahorran tiempo)
- **Docker Desktop** a veces está apagado: sin él la API responde 503 y `prisma migrate` falla con P1001. Arrancarlo y `docker compose up -d`.
- Prisma CLI: usar siempre la 6.19.3 (`npx prisma` sin fijar traía una 8 rc). En Windows, `prisma migrate/generate` falla por DLL bloqueada si hay procesos `node` vivos: pararlos antes.
- Shell de Windows: los heredocs con comillas/backticks y las regex con barras invertidas se rompen; escribir scripts auxiliares con archivos (no `node -e` largo).
- Fin de línea: git avisa "LF will be replaced by CRLF"; es inofensivo (`.gitattributes`), los scripts de Docker deben quedar en LF.
- Tests: las firmas de argon2 se abaratan con `NODE_ENV=test`; los límites de uso están desactivados en test; el dashboard sin filtro puede dar un 500 intermitente si otro test borra datos a la vez (el test lo reintenta).
- Nombre del taller: el parámetro `business.name` de la base de desarrollo vale "Servi-Gonzalez" (sin tilde, puesto por el dueño); no restablecerlo en pruebas.
- Los cambios de parámetros de sesión/enlaces/numeración rigen para lo que se emita desde ese momento.

## 8. Convenciones de trabajo con el asistente
- Idioma: español. Commits con el trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Hacer commit/push solo cuando el usuario lo pide (el remoto es `origin` = https://github.com/diedelrio/servig).
- Verificar los cambios de interfaz en Chrome real (playwright-core) y mantener `npm test`, `typecheck`, `build` y `oxlint` en verde antes de dar algo por hecho.
- Al cambiar reglas de negocio o la API, actualizar `docs/03-reglas-negocio.md` (numeradas RN-xx; la última es RN-38) y `docs/08-api.md`.
- Estilo de respuesta: breve, sin rodeos; informar con fidelidad lo que falló o no se pudo comprobar.

## 9. Mapa rápido de archivos clave
| Qué | Dónde |
|---|---|
| Flujo de estados | `backend/src/modules/repairs/workflow.ts` |
| Alta/lectura de reparaciones, numeración, resguardo contable | `backend/src/modules/repairs/service.ts` |
| Presupuestos y aprobación | `backend/src/modules/quotes/{service,approval}.ts` |
| Portal del cliente (API) | `backend/src/modules/portal/` |
| Web pública (API) | `backend/src/modules/public/` |
| Catálogos | `backend/src/modules/catalogs/` |
| Parámetros editables | `backend/src/lib/settings.ts`, `backend/src/modules/config/` |
| Correos y plantillas | `backend/src/lib/email.ts`, `emailTemplates.ts` |
| Permisos por rol | `backend/src/lib/seedRoles.ts` |
| Menús (taller/cliente) | `frontend/src/layout/nav.ts` |
| Páginas del portal del cliente | `frontend/src/PortalPages.tsx`, `PortalRequest.tsx`, `Profile.tsx` |
| Páginas públicas | `frontend/src/PublicPages.tsx` |
| Tema y tokens de diseño | `frontend/src/index.css`, `frontend/src/layout/layout.css`, `docs/LAYOUT-PORTALES.md` |
