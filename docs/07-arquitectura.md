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
