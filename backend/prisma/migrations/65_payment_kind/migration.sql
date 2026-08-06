-- Тип проводки в журнале платежей.
--
-- До этого в `payments` вперемешку лежали реальные поступления денег и служебные
-- записи зачёта переплаты. Кассовые отчёты складывали их вместе, из-за чего зачёт
-- считался вторым приходом тех же денег и завышал «Итого за период» и баланс компании.
--
-- CASH_IN         — деньги пришли в кассу.
-- CREDIT_TRANSFER — зачёт переплаты с других сделок клиента, денег не поступало.
-- ADJUSTMENT      — выравнивание paidAmount, изменённого мимо кассы (может быть < 0).
-- REVERSAL        — сторно ранее проведённого платежа.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentKind') THEN
    CREATE TYPE "PaymentKind" AS ENUM ('CASH_IN', 'CREDIT_TRANSFER', 'ADJUSTMENT', 'REVERSAL');
  END IF;
END$$;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "kind" "PaymentKind" NOT NULL DEFAULT 'CASH_IN';

-- Бэкфилл: помечаем уже существующие зачёты переплаты.
-- Опознаём их по примечанию — другого признака у старых записей нет.
-- Новый формат: '[Зачёт переплаты] источники: ...'
-- Старый формат: 'Зачёт переплаты с других сделок клиента'
UPDATE "payments"
SET "kind" = 'CREDIT_TRANSFER'
WHERE "kind" = 'CASH_IN'
  AND (
    "note" LIKE '[Зачёт переплаты]%'
    OR "note" LIKE 'Зачёт переплаты с других сделок клиента%'
  );

CREATE INDEX IF NOT EXISTS "payments_kind_paid_at_idx" ON "payments" ("kind", "paid_at");
