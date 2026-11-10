-- Отметка «Документы готовы» в заявке на оплату по перечислению раньше не доходила до сделки,
-- и сделка не попадала в группы производства/отгрузки. Переносим уже поставленные отметки
-- с заявок по сделке на сами сделки (пост в группу уйдёт при следующем изменении сделки).
UPDATE "deals" d
SET "docs_ready_at" = pr."docs_ready_at",
    "docs_ready_by_id" = pr."docs_ready_by_id"
FROM (
  SELECT DISTINCT ON ("deal_id") "deal_id", "docs_ready_at", "docs_ready_by_id"
  FROM "payment_requests"
  WHERE "deal_id" IS NOT NULL
    AND "method" = 'TRANSFER'
    AND "docs_ready_at" IS NOT NULL
    AND "status" IN ('PENDING', 'ACCEPTED')
  ORDER BY "deal_id", "docs_ready_at" ASC
) pr
WHERE d."id" = pr."deal_id"
  AND d."payment_method" = 'TRANSFER'
  AND d."docs_ready_at" IS NULL;
