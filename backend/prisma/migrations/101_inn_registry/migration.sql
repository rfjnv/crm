-- Справочник «ИНН → юр. название»: ИНН из клиентов и перечислений по сделкам.
-- Название подтягивается с orginfo.uz или вписывается вручную.
CREATE TABLE "inn_registry" (
    "inn" TEXT NOT NULL,
    "legal_name" TEXT,
    "address" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "lookup_status" TEXT,
    "looked_up_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inn_registry_pkey" PRIMARY KEY ("inn")
);
