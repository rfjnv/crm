-- TimePay: какие филиалы синхронизировать и каких сотрудников скрыть.
ALTER TABLE "timepay_integration" ADD COLUMN "branches" TEXT[] NOT NULL DEFAULT ARRAY['Polygraph']::TEXT[];
ALTER TABLE "timepay_integration" ADD COLUMN "hidden_employee_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
