-- AlterTable
ALTER TABLE "Tool" ADD COLUMN     "modelId" INTEGER;

-- CreateTable
CREATE TABLE "Brand" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameKey" VARCHAR(80) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolType" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameKey" VARCHAR(80) NOT NULL,

    CONSTRAINT "ToolType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolModel" (
    "id" SERIAL NOT NULL,
    "brandId" INTEGER NOT NULL,
    "toolTypeId" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameKey" VARCHAR(80) NOT NULL,

    CONSTRAINT "ToolModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_nameKey_key" ON "Brand"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "ToolType_nameKey_key" ON "ToolType"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "ToolModel_brandId_toolTypeId_nameKey_key" ON "ToolModel"("brandId", "toolTypeId", "nameKey");

-- CreateIndex
CREATE INDEX "Tool_modelId_idx" ON "Tool"("modelId");

-- AddForeignKey
ALTER TABLE "Tool" ADD CONSTRAINT "Tool_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ToolModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolModel" ADD CONSTRAINT "ToolModel_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolModel" ADD CONSTRAINT "ToolModel_toolTypeId_fkey" FOREIGN KEY ("toolTypeId") REFERENCES "ToolType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rellena los catálogos con lo ya registrado y unifica las variantes de escritura («Bosch», «bosch», «BOSCH »):
-- el nombre que queda es el más usado de cada grupo.
CREATE TEMP TABLE _t AS
SELECT id,
       left(btrim(regexp_replace(brand, '\s+', ' ', 'g')), 80) AS b,
       left(btrim(regexp_replace(type, '\s+', ' ', 'g')), 80) AS t,
       left(btrim(regexp_replace(model, '\s+', ' ', 'g')), 80) AS m
FROM "Tool";

INSERT INTO "Brand" (name, "nameKey")
SELECT DISTINCT ON (lower(b)) b, lower(b) FROM (SELECT b, count(*) c FROM _t WHERE b <> '' GROUP BY b) x ORDER BY lower(b), c DESC, b;

INSERT INTO "ToolType" (name, "nameKey")
SELECT DISTINCT ON (lower(t)) t, lower(t) FROM (SELECT t, count(*) c FROM _t WHERE t <> '' GROUP BY t) x ORDER BY lower(t), c DESC, t;

INSERT INTO "ToolModel" ("brandId", "toolTypeId", name, "nameKey")
SELECT DISTINCT ON (br.id, ty.id, lower(x.m)) br.id, ty.id, x.m, lower(x.m)
FROM (SELECT b, t, m, count(*) c FROM _t WHERE m <> '' AND b <> '' AND t <> '' GROUP BY b, t, m) x
JOIN "Brand" br ON br."nameKey" = lower(x.b)
JOIN "ToolType" ty ON ty."nameKey" = lower(x.t)
ORDER BY br.id, ty.id, lower(x.m), x.c DESC, x.m;

UPDATE "Tool" tl
SET "modelId" = tm.id, brand = br.name, type = ty.name, model = tm.name
FROM _t, "Brand" br, "ToolType" ty, "ToolModel" tm
WHERE _t.id = tl.id AND br."nameKey" = lower(_t.b) AND ty."nameKey" = lower(_t.t)
  AND tm."brandId" = br.id AND tm."toolTypeId" = ty.id AND tm."nameKey" = lower(_t.m);

DROP TABLE _t;
