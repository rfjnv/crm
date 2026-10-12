-- HR не продаёт: снимаем сделки и правку клиентов, открываем отдел ВЭД
-- (поставщики, импорт-заказы). Остальные права, выданные поимённо, не трогаем.
UPDATE "users"
SET "permissions" = ARRAY(
  SELECT DISTINCT p
  FROM unnest(
    array_remove(array_remove("permissions", 'manage_deals'), 'edit_client')
    || ARRAY['view_all_clients', 'manage_suppliers', 'manage_import_orders', 'view_import_orders']
  ) AS p
)
WHERE "role" = 'HR';
