-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APROBADO', 'RECHAZADO');

-- CreateTable
CREATE TABLE "QuoteLinkToken" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteApproval" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin" "HistoryOrigin" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "userId" INTEGER,
    "comment" TEXT,

    CONSTRAINT "QuoteApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLinkToken_tokenHash_key" ON "QuoteLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "QuoteLinkToken_versionId_idx" ON "QuoteLinkToken"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteApproval_versionId_key" ON "QuoteApproval"("versionId");

-- AddForeignKey
ALTER TABLE "QuoteLinkToken" ADD CONSTRAINT "QuoteLinkToken_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteApproval" ADD CONSTRAINT "QuoteApproval_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteApproval" ADD CONSTRAINT "QuoteApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
