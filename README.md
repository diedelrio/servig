# Servig — gestión de reparaciones de herramientas

Aplicación web para que un taller gestione, de punta a punta, las herramientas de sus clientes (dentro y fuera de garantía):

**Cliente → herramienta → recepción y resguardo → diagnóstico → presupuesto → aprobación del cliente → repuestos → reparación → listo para retirar → entrega**, con trazabilidad completa de cada reparación.

**Regla crítica:** ninguna reparación que requiera presupuesto puede empezar sin la aprobación explícita del cliente. Se valida en el servidor, no solo en la pantalla.

## Qué incluye

- **Personal** (ADMIN, RECEPCION, TECNICO): clientes y herramientas, recepción con resguardo imprimible, workflow con historial inmutable, diagnóstico, presupuestos versionados, repuestos, dashboard, búsqueda global, usuarios y roles, auditoría y registro de correos.
- **Cliente:** portal para ver sus reparaciones, el seguimiento, el diagnóstico visible y los documentos, y **aprobar o rechazar presupuestos** (por el portal o por un enlace seguro de un solo uso enviado por correo).
- Autenticación completa: registro, confirmación de email, recuperación de contraseña, sesiones con refresh rotativo, Argon2id.

## Stack

React + Vite + React Router + Axios · Node.js + Express 5 · PostgreSQL + Prisma · JWT. Un único repositorio con `backend/` y `frontend/`; se despliega como una sola imagen Docker.

## Empezar

```sh
docker compose up -d                       # PostgreSQL y Mailpit (correos de desarrollo en http://localhost:8025)
cd backend && cp .env.example .env && npm install && npx prisma migrate dev && npm run seed && npm run dev
cd frontend && npm install && npm run dev  # http://localhost:5173
```

Usuario inicial de desarrollo: el de `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` en `backend/.env`.

## Pruebas

```sh
cd backend && npm test        # 230+ pruebas: workflow, regla crítica, tokens, roles, portal, seguridad, aceptación…
```

## Documentación

Todo está en [`docs/`](docs/): visión, requisitos, reglas de negocio, workflow, autenticación y seguridad, modelo de datos, arquitectura, API, backlog, casos de uso, criterios de aceptación y **[despliegue y operación](docs/12-deployment.md)** (variables, PaaS, volumen de adjuntos, copias de seguridad y restauración, lista previa a producción).
