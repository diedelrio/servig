-- Pedidos de reparación hechos por el cliente desde el portal: la herramienta aún no llegó al taller.
ALTER TYPE "RepairStatus" ADD VALUE IF NOT EXISTS 'SOLICITADA' BEFORE 'RECIBIDO';
