-- HR переходит на полставки в отдел ВЭД: даём HR те же права, что у ВЭД
-- (склад, приход, товары, все сделки, договоры, расходы, поставщики, импорт).
-- Права, выданные поимённо, не трогаем — только добавляем недостающие.
UPDATE "users"
SET "permissions" = ARRAY(
  SELECT DISTINCT p
  FROM unnest(
    "permissions" || ARRAY[
      'manage_inventory', 'create_inventory_in', 'manage_products', 'view_all_deals', 'view_all_clients',
      'manage_contract', 'manage_expenses', 'manage_suppliers', 'manage_import_orders', 'view_import_orders'
    ]
  ) AS p
)
WHERE "role" = 'HR';
