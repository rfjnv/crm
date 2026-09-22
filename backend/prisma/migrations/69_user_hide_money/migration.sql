-- Сотруднику не показывают денежные суммы (сделки, выручка, долги); цены товаров видны.
ALTER TABLE "users" ADD COLUMN "hide_money" BOOLEAN NOT NULL DEFAULT false;
