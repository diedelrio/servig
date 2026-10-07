export const STATUS_LABEL: Record<string, string> = {
  RECIBIDO: 'Recibido',
  EN_REVISION: 'En revisión',
  PRESUPUESTO_PENDIENTE_APROBACION: 'Presupuesto pendiente de aprobación',
  PRESUPUESTO_APROBADO: 'Presupuesto aprobado',
  PRESUPUESTO_RECHAZADO: 'Presupuesto rechazado',
  PEDIDO_REPUESTOS_MARCA: 'Repuestos pedidos a la marca',
  EN_REPARACION: 'En reparación',
  REPARADO: 'Reparado',
  LISTO_PARA_RETIRAR: 'Listo para retirar',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado',
}

export const ORIGIN_LABEL: Record<string, string> = {
  STAFF: 'Personal del taller',
  CUSTOMER_LINK: 'Cliente (enlace)',
  CUSTOMER_PORTAL: 'Cliente (portal)',
  SYSTEM: 'Sistema',
}

export const fmtDateTime = (d: string) => new Date(d).toLocaleString()
