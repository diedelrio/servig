-- DropForeignKey
ALTER TABLE "Repair" DROP CONSTRAINT "Repair_receivedById_fkey";

-- AlterTable
ALTER TABLE "Repair" ADD COLUMN     "accountingReceipt" VARCHAR(40),
ALTER COLUMN "receivedById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PublicRequest" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(40),
    "modelId" INTEGER,
    "type" VARCHAR(80) NOT NULL,
    "brand" VARCHAR(80) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "serialNumber" VARCHAR(80),
    "declaredFault" VARCHAR(2000) NOT NULL,
    "notes" VARCHAR(2000),
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "repairId" INTEGER,
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairViewToken" (
    "id" SERIAL NOT NULL,
    "repairId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairViewToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicRequest_tokenHash_key" ON "PublicRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "PublicRequest_email_idx" ON "PublicRequest"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RepairViewToken_tokenHash_key" ON "RepairViewToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RepairViewToken_repairId_idx" ON "RepairViewToken"("repairId");

-- CreateIndex
CREATE INDEX "Repair_accountingReceipt_idx" ON "Repair"("accountingReceipt");

-- AddForeignKey
ALTER TABLE "Repair" ADD CONSTRAINT "Repair_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairViewToken" ADD CONSTRAINT "RepairViewToken_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "Repair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
