# 12 · Deployment

## Desarrollo local
```
docker compose up -d        # PostgreSQL :5433, Mailpit UI :8025 / SMTP :1025
cd backend && cp .env.example .env && npm i && npx prisma migrate dev && npm run seed && npm run dev
cd frontend && npm i && npm run dev
```

## Variables (backend)
`DATABASE_URL`, `JWT_SECRET`, `REFRESH_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `FRONTEND_URL`, `UPLOAD_DIR`, `PORT`.

## Producción (a detallar en Fase 12)
- Frontend: build estático (`npm run build`) en Vercel/Netlify/Nginx.
- Backend: contenedor Node con `prisma migrate deploy`.
- PostgreSQL gestionado con backups.
- SMTP real (Resend/SES/Brevo). Cookies `Secure`, HTTPS obligatorio.
- Adjuntos: migrar `storage` a S3/R2 antes de escalar a más de una instancia.
