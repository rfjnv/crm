-- Цель выручки за год для блока «Цели» на дашборде (пусто — месячная цель × 12)
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "yearly_revenue_goal" DOUBLE PRECISION;
