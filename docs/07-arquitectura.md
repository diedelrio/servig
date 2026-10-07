# 07 · Arquitectura

Monorepo:

```
/backend    Express + Prisma + Zod (módulos por dominio)
/frontend   React + Vite + React Router + Axios
/docs
docker-compose.yml   PostgreSQL + Mailpit (dev)
```

## Backend
`src/modules/<dominio>/{routes,service,schemas}.ts`, más `src/lib` (prisma, email, storage, audit, tokens) y `src/middleware` (auth, permisos, errores). Sin repositorios ni capas extra: servicios usan Prisma directamente.

- Email: interfaz `send()` sobre Nodemailer/SMTP; cada envío escribe `EmailLog`.
- Storage: interfaz `save/read` sobre disco (`uploads/`); intercambiable por S3/R2.
- Transiciones de estado: una única función `transitionRepair()` valida matriz, regla RN-01 y escribe historial + auditoría en una transacción.

## Frontend
Páginas por rol, layout responsive, Axios con interceptor de refresh. Rutas protegidas por rol.

## Despliegue futuro
Frontend estático (Vercel/Netlify), backend en contenedor, PostgreSQL gestionado, SMTP real, S3/R2.

## Producción (Fase 12)
Una sola imagen (ver `Dockerfile`): la API sirve el frontend compilado desde `STATIC_DIR` con *fallback* a `index.html` para las rutas del cliente y 404 en JSON para `/api/*`. Misma URL para la app y la API → cookie de refresco `SameSite=Lax` sin CORS. Cabeceras de seguridad con `helmet` (CSP estricta). Detalle operativo en `docs/12-deployment.md`.

## Layout de los portales (según `docs/LAYOUT-PORTALES.md`)
- `AppLayout` elige el marco por rol: **portal del taller** (ADMIN, RECEPCION, TECNICO; cabecera 58 px, barra lateral 72→220 px que *empuja* el contenido, hamburguesa ≤ 900 px) o **portal del cliente** (CLIENTE; cabecera 64 px, barra lateral 76→240 px que se *superpone*, barra inferior ≤ 768 px).
- Código en `frontend/src/layout/` (`AdminShell`, `ClientShell`, `UserMenu`, `NavItemLink`, `nav.ts`, `layout.css`). El menú del taller se filtra por permisos; añadir una pantalla = una entrada en `nav.ts`.
- Tokens y estilos de componentes en `index.css`; páginas nuevas: inicio del cliente (`/portal`), listado (`/portal/reparaciones`) y **Mi perfil** (`/perfil`, cambio de contraseña por correo).
- **Desviaciones deliberadas del documento:** la fuente Inter va **autoalojada** (`@fontsource-variable/inter`) en vez de Google Fonts, para no depender de terceros y respetar la CSP; el logo es un SVG propio (`public/logo.png`, sustituible); solo tema claro (se eliminó el modo oscuro); el grupo del menú es «Administración» (Usuarios, Correos, Auditoría) en lugar de «Reportes»; la barra inferior del cliente tiene 3 pestañas (no 4) porque no existe «Nueva reserva»; el panel móvil del taller incluye el buscador global.
