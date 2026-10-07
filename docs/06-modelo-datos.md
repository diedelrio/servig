# 06 · Modelo de datos

Fuente de verdad: `backend/prisma/schema.prisma`. Resumen:

- **User** (email único, passwordHash, status PENDING_EMAIL_VERIFICATION|ACTIVE|DISABLED, emailVerifiedAt, roleId, customerId?)
- **Role**, **Permission**, **RolePermission**
- **EmailVerificationToken**, **PasswordResetToken** (tokenHash, expiresAt, usedAt)
- **RefreshToken** (tokenHash, expiresAt, revokedAt)
- **Customer** (nombre/razón social, taxId, email, teléfono, dirección, observaciones)
- **Tool** (customerId, tipo, marca, modelo, serie, fecha compra, garantía, vencimiento, descripción)
- **Repair** (number, customerId, toolId, receivedAt, declaredFault, visualState, accessories, inWarranty, requiresQuote, status, receivedById)
- **RepairStatusHistory** (append-only)
- **Diagnosis** (repairId, texto, visibleToCustomer, authorId)
- **Quote** (repairId, status, currentVersion), **QuoteVersion**, **QuoteItem** (tipo LABOR|PART|OTHER, qty, precio, IVA%), **QuoteApproval** (versión, decisión, fecha, origen, IP)
- **QuoteLinkToken** (token de aprobación por enlace)
- **RepairSparePart** (código, descripción, proveedor, cantidad, coste y precio unitarios, estado, fechas de pedido y recepción). No hay catálogo `SparePart` en el MVP: se añadirá si se necesita autocompletar o stock.
- **Attachment** (repairId, path, mime, size, visibleToCustomer — privado por defecto)
- **EmailLog** (destinatario, tipo, asunto, entidad, resultado, error, intentos) — absorbe Notification
- **AuditLog**
- **Counter** (numeración anual), **Settings** (IVA por defecto, vencimientos)
