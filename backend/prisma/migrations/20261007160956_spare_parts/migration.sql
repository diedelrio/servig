-- CreateEnum
CREATE TYPE "SparePartStatus" AS ENUM ('NECESARIO', 'SOLICITADO', 'PEDIDO_A_MARCA', 'RECIBIDO', 'INSTALADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "RepairSparePart" (
    "id" SERIAL NOT NULL,
    "repairId" INTEGER NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "quantity" INTEGER NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "status" "SparePartStatus" NOT NULL DEFAULT 'NECESARIO',
    "orderedAt" DATE,
    "receivedAt" DATE,
    "notes" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairSparePart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairSparePart_repairId_idx" ON "RepairSparePart"("repairId");

-- AddForeignKey
ALTER TABLE "RepairSparePart" ADD CONSTRAINT "RepairSparePart_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "Repair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairSparePart" ADD CONSTRAINT "RepairSparePart_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
