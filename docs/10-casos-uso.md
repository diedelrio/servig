# 10 · Casos de uso

**CU-01 Registrarse y activar cuenta** (Visitante): registro → email → enlace → ACTIVE → login.

**CU-02 Recuperar contraseña** (Usuario): email → mensaje genérico → enlace → nueva contraseña → sesiones revocadas.

**CU-03 Recepcionar herramienta** (RECEPCION): buscar/crear cliente → buscar/crear herramienta → declarar avería, estado, accesorios, fotos → generar REP-… → imprimir resguardo → email al cliente.

**CU-04 Diagnosticar y presupuestar** (TECNICO): EN_REVISION → diagnóstico → presupuesto BORRADOR → enviar → PRESUPUESTO_PENDIENTE_APROBACION → email con enlace.

**CU-05 Decidir presupuesto** (CLIENTE): abrir enlace o portal → ver detalle → aprobar/rechazar → se registra decisión, IP, origen → notifica al taller.

**CU-06 Reparar** (TECNICO): aprobado → (pedir repuestos → recibir) → EN_REPARACION → REPARADO → LISTO_PARA_RETIRAR → email.

**CU-07 Entregar** (RECEPCION): LISTO_PARA_RETIRAR → ENTREGADO con comentario.

**CU-08 Consultar estado** (CLIENTE): portal con timeline y documentos.

**CU-09 Administrar usuarios** (ADMIN): crear personal, asignar rol, desactivar.

**CU-10 Operar el taller** (todos los de personal): dashboard y búsqueda.
