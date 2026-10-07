Quiero que actúes como **Product Owner, Analista Funcional, Arquitecto de Software y Senior Full-Stack Developer** para diseñar y desarrollar desde cero un **MVP de una aplicación web de Gestión de Reparaciones de Herramientas**.

El sistema será utilizado inicialmente por un comercio/taller que recibe herramientas de clientes para diagnóstico y reparación, tanto **dentro como fuera de garantía**.

## Principio fundamental: estamos construyendo un MVP

Esta primera versión debe ser un **Minimum Viable Product (MVP)** funcional, seguro y desplegable.

Priorizar:

* simplicidad
* velocidad de desarrollo
* buena experiencia de usuario
* seguridad
* mantenibilidad
* trazabilidad
* bajo coste de infraestructura
* posibilidad de evolucionar posteriormente

Evitar:

* microservicios innecesarios
* infraestructura compleja
* patrones arquitectónicos que no aporten valor al MVP
* funcionalidades especulativas
* sobreingeniería

Sin embargo, el código y el modelo de datos deben quedar suficientemente organizados para permitir evolución futura.

El objetivo del MVP es poder operar realmente un taller con el sistema.

---

# 1. Objetivo del MVP

El MVP debe cubrir de punta a punta:

Cliente
→ Herramienta
→ Recepción
→ Resguardo
→ Diagnóstico
→ Presupuesto
→ Envío al cliente
→ Aprobación/Rechazo
→ Pedido de repuestos
→ Reparación
→ Listo para retirar
→ Entrega

Debe existir trazabilidad completa de cada reparación.

---

# 2. Stack tecnológico

Frontend:

* React
* Vite
* React Router
* Axios
* Diseño responsive

Backend:

* Node.js
* Express
* API REST

Base de datos:

* PostgreSQL
* Prisma ORM / Prisma Client

Autenticación y seguridad:

* JWT
* Argon2id para hash de contraseñas
* Tokens seguros de un solo uso para confirmación y recuperación
* Roles y permisos
* Validación de inputs
* Auditoría de operaciones importantes

Infraestructura MVP:

* Desarrollo local
* PostgreSQL mediante Docker
* `.env` para configuración
* Un único repositorio Git
* Frontend y backend separados dentro del mismo repositorio

La arquitectura debe permitir posteriormente desplegar frontend, backend y PostgreSQL en servicios cloud.

---

# 3. Autenticación y gestión de usuarios

El MVP debe incluir un **workflow completo de autenticación y administración de usuarios**.

No quiero solamente una pantalla de login.

Debe implementarse el ciclo completo:

Registro
→ Confirmación de email
→ Activación de cuenta
→ Login
→ Sesión
→ Recuperación de contraseña
→ Cambio de contraseña

## 3.1 Registro

Permitir crear una cuenta mediante:

* nombre
* apellido
* email
* contraseña
* confirmación de contraseña

El email debe ser único.

Validar formato de email y política mínima de seguridad de contraseña.

La contraseña **nunca debe almacenarse en texto plano ni cifrada de forma reversible**.

Utilizar:

**Argon2id**

para generar un hash seguro de la contraseña.

---

# 4. Confirmación de email

Cuando un usuario se registra:

1. Crear el usuario con estado:

PENDING_EMAIL_VERIFICATION

2. Generar un token criptográficamente seguro y de un solo uso.

3. El token debe tener fecha de vencimiento.

4. Enviar automáticamente un email al usuario.

Ejemplo:

"Bienvenido. Para activar tu cuenta haz clic en el siguiente enlace."

El enlace tendrá una estructura equivalente a:

`/verify-email?token=TOKEN`

5. Cuando el usuario acceda al enlace:

* validar token
* validar vencimiento
* comprobar que no fue utilizado
* activar la cuenta
* invalidar el token

El usuario pasa a:

ACTIVE

6. Registrar fecha/hora de verificación.

Un usuario que no confirmó su email no podrá iniciar sesión normalmente.

Debe existir también:

**Reenviar email de confirmación**

aplicando controles para evitar abuso del envío de emails.

---

# 5. Login

Crear pantalla de login mediante:

* email
* contraseña

El backend debe:

1. buscar usuario
2. verificar que esté activo
3. verificar contraseña mediante Argon2id
4. crear la sesión/token correspondiente
5. registrar el acceso cuando corresponda

Mensajes de error no deben revelar información sensible.

Por ejemplo, evitar diferenciar innecesariamente entre:

"usuario inexistente"

y

"contraseña incorrecta".

Utilizar mensajes genéricos cuando sea conveniente por seguridad.

---

# 6. Recuperación de contraseña

En el login debe existir:

**¿Olvidaste tu contraseña?**

Workflow:

Usuario
→ Ingresa email
→ Sistema genera token
→ Sistema envía email
→ Usuario accede al enlace
→ Define nueva contraseña
→ Token queda invalidado

El usuario introduce su email.

Por seguridad, la aplicación debe responder de forma genérica:

"Si existe una cuenta asociada a este email, recibirás instrucciones para recuperar tu contraseña."

No confirmar públicamente si el usuario existe.

---

# 7. Email de recuperación

Si el usuario existe:

1. generar token criptográficamente seguro
2. guardar referencia segura del token
3. establecer vencimiento
4. enviar email

El email incluirá un enlace equivalente a:

`/reset-password?token=TOKEN`

El token:

* debe ser de un solo uso
* debe vencer
* no debe poder reutilizarse después de cambiar la contraseña

---

# 8. Cambio de contraseña

Al acceder mediante un token válido:

Mostrar:

* Nueva contraseña
* Confirmar nueva contraseña

Validar política de contraseña.

Guardar nuevamente mediante:

**Argon2id**

Nunca guardar contraseñas anteriores en texto plano.

Después de cambiarla:

* invalidar token
* registrar fecha/hora
* invalidar sesiones anteriores si la arquitectura utilizada lo permite
* permitir iniciar sesión con la nueva contraseña

---

# 9. Emails transaccionales

El MVP tendrá un servicio centralizado de emails.

Debe soportar inicialmente:

AUTH:

* confirmación de registro
* reenvío de confirmación
* recuperación de contraseña
* confirmación de cambio de contraseña

REPARACIONES:

* herramienta recibida
* presupuesto disponible
* presupuesto aprobado
* presupuesto rechazado
* reparación finalizada
* herramienta lista para retirar

El proveedor de email debe estar desacoplado.

Toda configuración debe realizarse mediante variables de entorno.

Ejemplo:

SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
EMAIL_FROM
FRONTEND_URL

No colocar credenciales directamente en código.

---

# 10. Registro de emails

Crear un mecanismo de registro de emails enviados.

Guardar como mínimo:

* destinatario
* tipo
* asunto
* entidad relacionada
* fecha/hora
* resultado
* error si ocurrió
* intentos

Esto debe permitir diagnosticar problemas de envío.

---

# 11. Roles

Inicialmente:

ADMIN

Administración completa.

RECEPCION

* clientes
* herramientas
* recepción
* resguardos
* consulta
* entrega

TECNICO

* diagnóstico
* presupuestos
* repuestos
* reparación
* estados de taller

CLIENTE

* consultar sus reparaciones
* consultar estado
* consultar presupuesto
* aprobar/rechazar presupuesto
* consultar documentación

Diseñar permisos de manera extensible.

---

# 12. Administración de clientes

Cada cliente puede tener múltiples herramientas y reparaciones.

Datos mínimos:

* Nombre / razón social
* DNI/NIF/CIF
* Email
* Teléfono
* Dirección
* Observaciones
* Fecha de alta

Mostrar:

* herramientas
* reparaciones activas
* historial
* presupuestos
* documentos

---

# 13. Herramientas

Registrar:

* Tipo
* Marca
* Modelo
* Número de serie
* Fecha de compra
* Garantía
* Vencimiento de garantía
* Descripción
* Observaciones

Una herramienta puede tener múltiples reparaciones históricas.

---

# 14. Recepción

Crear reparación con número único.

Ejemplo:

REP-2026-000123

Registrar:

* Cliente
* Herramienta
* Fecha/hora
* Avería declarada
* Estado visual
* Accesorios
* Garantía
* Observaciones
* Usuario receptor

Permitir adjuntar fotografías/documentos.

Generar un resguardo imprimible y preparado para PDF.

---

# 15. Workflow de reparación

Estados:

RECIBIDO

EN_REVISION

PRESUPUESTO_PENDIENTE_APROBACION

PRESUPUESTO_APROBADO

PRESUPUESTO_RECHAZADO

PEDIDO_REPUESTOS_MARCA

EN_REPARACION

REPARADO

LISTO_PARA_RETIRAR

ENTREGADO

CANCELADO

Cada transición debe registrar:

* estado anterior
* estado nuevo
* fecha/hora
* usuario
* comentario
* origen

Nunca sobrescribir el historial.

---

# 16. Presupuestos

Permitir:

* Mano de obra
* Repuestos
* Otros conceptos
* Cantidad
* Precio
* Impuestos
* Total

Estados:

BORRADOR
ENVIADO
APROBADO
RECHAZADO
VENCIDO
CANCELADO

Los presupuestos enviados deben versionarse.

---

# 17. Regla crítica

**NINGUNA reparación que requiera presupuesto puede comenzar hasta recibir aprobación explícita del cliente.**

La validación debe realizarse en el backend.

No confiar únicamente en el frontend.

Workflow:

Presupuesto creado
→ Presupuesto enviado
→ Email al cliente
→ Pendiente aprobación

El cliente accede mediante enlace seguro.

Puede:

APROBAR

o

RECHAZAR

Registrar:

* presupuesto
* versión
* decisión
* fecha/hora
* origen
* IP cuando corresponda

Solo después de aprobación:

PRESUPUESTO_APROBADO
→ EN_REPARACION

---

# 18. Repuestos

Estados:

NECESARIO
SOLICITADO
PEDIDO_A_MARCA
RECIBIDO
INSTALADO
CANCELADO

Registrar:

* código
* descripción
* proveedor/marca
* cantidad
* coste
* precio
* fecha pedido
* fecha recepción

---

# 19. Portal cliente

El cliente podrá consultar desde móvil o PC:

* reparaciones activas
* historial
* herramienta
* estado
* timeline
* diagnóstico visible
* presupuesto
* documentos
* repuestos cuando corresponda

Y podrá:

**APROBAR o RECHAZAR presupuestos.**

---

# 20. Dashboard taller

Mostrar:

* recibidas
* en revisión
* pendientes de presupuesto
* esperando aprobación
* aprobadas
* esperando repuestos
* en reparación
* listas para retirar
* atrasadas

---

# 21. Auditoría

Registrar operaciones importantes:

* usuarios
* clientes
* herramientas
* reparaciones
* diagnósticos
* presupuestos
* aprobaciones/rechazos
* cambios de estado
* entregas
* autenticación relevante

Guardar:

* usuario
* acción
* entidad
* ID
* fecha/hora
* datos relevantes

---

# 22. Modelo de datos

Analizar como mínimo:

User
Role
Permission
EmailVerificationToken
PasswordResetToken
Customer
Tool
Repair
RepairStatusHistory
Diagnosis
Quote
QuoteVersion
QuoteItem
QuoteApproval
SparePart
RepairSparePart
Attachment
Notification
EmailLog
AuditLog

No asumir que esta lista es definitiva.

Proponer mejoras si son necesarias.

---

# 23. Documentación

Crear:

`/docs`

Con:

01-vision-mvp.md
02-requisitos-funcionales.md
03-reglas-negocio.md
04-workflow-reparaciones.md
05-autenticacion-seguridad.md
06-modelo-datos.md
07-arquitectura.md
08-api.md
09-backlog-mvp.md
10-casos-uso.md
11-criterios-aceptacion.md
12-deployment.md

---

# 24. Backlog MVP

Organizar:

EPIC
→ FEATURE
→ USER STORY
→ TASK

Cada historia debe contener:

* descripción
* rol
* necesidad
* beneficio
* criterios de aceptación
* dependencias
* prioridad

Usar Given / When / Then para criterios de aceptación.

Clasificar funcionalidades como:

MUST HAVE — necesarias para el MVP.

SHOULD HAVE — importantes pero postergables.

COULD HAVE — futuras.

---

# 25. Estrategia de implementación

Proponer una secuencia incremental.

Como referencia:

FASE 0 — Setup técnico

FASE 1 — Autenticación completa

FASE 2 — Usuarios y roles

FASE 3 — Clientes y herramientas

FASE 4 — Recepción y resguardo

FASE 5 — Workflow e historial

FASE 6 — Diagnóstico y presupuestos

FASE 7 — Aprobación digital

FASE 8 — Repuestos y reparación

FASE 9 — Portal cliente

FASE 10 — Emails, documentos y auditoría

FASE 11 — Dashboard y búsquedas

FASE 12 — Testing, seguridad y deployment

Puedes proponer otra secuencia si técnicamente es mejor.

---

# 26. Forma de trabajo con la IA

No desarrolles toda la aplicación de una vez.

Primero:

1. Analiza los requisitos.
2. Detecta huecos funcionales.
3. Identifica decisiones pendientes.
4. Pregúntame lo necesario.
5. Define claramente qué entra y qué NO entra en el MVP.
6. Diseña el workflow.
7. Diseña el modelo de datos.
8. Diseña la arquitectura.
9. Genera el backlog.
10. Propón el orden de implementación.

**No escribas código hasta que yo apruebe estas definiciones.**

No inventes reglas importantes.

Cuando exista una decisión pendiente:

* explícala
* presenta alternativas
* indica ventajas/desventajas
* recomienda una opción para el MVP

Una vez aprobada la definición funcional y técnica, implementaremos el proyecto **fase por fase**, validando cada fase antes de continuar.

El objetivo final es tener un **MVP realmente utilizable por un taller**, no una demo ni un prototipo visual.
