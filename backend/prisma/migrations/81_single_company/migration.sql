-- Проект работает только для Polygraph Business. Grand Astra удаляется вместе с её данными,
-- а сама модель компаний (таблица companies и company_id у users/clients/products) — целиком.
--
-- Принадлежность к Grand Astra определялась так: клиент и товар — по своему company_id,
-- сделка — через клиента (своего company_id у сделок нет). Если компании в базе нет,
-- все шаги ниже ничего не меняют, кроме удаления колонок и таблицы.

CREATE TEMP TABLE ga_clients AS
  SELECT c.id FROM clients c JOIN companies co ON co.id = c.company_id WHERE co.name = 'grand-astra';
CREATE TEMP TABLE ga_deals AS
  SELECT d.id FROM deals d WHERE d.client_id IN (SELECT id FROM ga_clients);
CREATE TEMP TABLE ga_contracts AS
  SELECT ct.id FROM contracts ct WHERE ct.client_id IN (SELECT id FROM ga_clients);

-- ─── Сделки Grand Astra ─────────────────────────────────────────────────────
-- Движения склада остаются: остатки товаров хранятся отдельно и уже учитывают эти списания.
-- Без сделки такое движение — корректировка, в продажи оно не попадает (см. lib/inventoryAnalytics).
UPDATE inventory_movements SET deal_id = NULL WHERE deal_id IN (SELECT id FROM ga_deals);
UPDATE client_stock_events SET source_deal_id = NULL WHERE source_deal_id IN (SELECT id FROM ga_deals);
UPDATE messages SET deal_id = NULL WHERE deal_id IN (SELECT id FROM ga_deals);
DELETE FROM telegram_weigh_prompts WHERE deal_id IN (SELECT id FROM ga_deals);
DELETE FROM payments WHERE deal_id IN (SELECT id FROM ga_deals) OR client_id IN (SELECT id FROM ga_clients);
-- Строки, комментарии, отгрузки и оценки сделок удаляются каскадом.
DELETE FROM deals WHERE id IN (SELECT id FROM ga_deals);

-- ─── Договоры и клиенты Grand Astra ─────────────────────────────────────────
UPDATE deals SET contract_id = NULL WHERE contract_id IN (SELECT id FROM ga_contracts);
DELETE FROM powers_of_attorney WHERE contract_id IN (SELECT id FROM ga_contracts);
DELETE FROM contracts WHERE id IN (SELECT id FROM ga_contracts);
UPDATE call_sessions SET client_id = NULL WHERE client_id IN (SELECT id FROM ga_clients);
UPDATE call_audits SET client_id = NULL WHERE client_id IN (SELECT id FROM ga_clients);
-- Заметки, резервы, остатки у клиента и строки доски заметок удаляются каскадом.
DELETE FROM clients WHERE id IN (SELECT id FROM ga_clients);

-- ─── Товары Grand Astra ─────────────────────────────────────────────────────
-- Удаляются те, на которые больше ничего не ссылается. Остальные (есть в сделках или
-- закупках Polygraph) не удалить без потери истории — они выключаются и пропадают из каталога.
CREATE TEMP TABLE ga_products AS
  SELECT p.id FROM products p JOIN companies co ON co.id = p.company_id WHERE co.name = 'grand-astra';
CREATE TEMP TABLE ga_products_kept AS
  SELECT gp.id FROM ga_products gp
  WHERE EXISTS (SELECT 1 FROM deal_items di WHERE di.product_id = gp.id)
     OR EXISTS (SELECT 1 FROM import_order_items ii WHERE ii.product_id = gp.id)
     OR EXISTS (SELECT 1 FROM client_stock_positions sp WHERE sp.product_id = gp.id)
     OR EXISTS (SELECT 1 FROM client_stock_events se WHERE se.product_id = gp.id);

UPDATE products SET is_active = false WHERE id IN (SELECT id FROM ga_products_kept);
DELETE FROM inventory_movements
  WHERE product_id IN (SELECT id FROM ga_products) AND product_id NOT IN (SELECT id FROM ga_products_kept);
DELETE FROM product_reservations
  WHERE product_id IN (SELECT id FROM ga_products) AND product_id NOT IN (SELECT id FROM ga_products_kept);
-- Фото товара удаляются каскадом.
DELETE FROM products
  WHERE id IN (SELECT id FROM ga_products) AND id NOT IN (SELECT id FROM ga_products_kept);

-- ─── Сотрудники Grand Astra ─────────────────────────────────────────────────
-- Не удаляются: на них ссылаются журнал действий, задачи и заметки. Учётки выключаются,
-- открытые сессии закрываются. SUPER_ADMIN не трогаем, чтобы не потерять доступ к системе.
CREATE TEMP TABLE ga_users AS
  SELECT u.id FROM users u JOIN companies co ON co.id = u.company_id
  WHERE co.name = 'grand-astra' AND u.role <> 'SUPER_ADMIN';
UPDATE users SET is_active = false WHERE id IN (SELECT id FROM ga_users);
UPDATE sessions SET revoked_at = NOW() WHERE user_id IN (SELECT id FROM ga_users) AND revoked_at IS NULL;

DROP TABLE ga_clients, ga_deals, ga_contracts, ga_products, ga_products_kept, ga_users;

-- ─── Модель компаний больше не нужна ────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_company_id_fkey;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_company_id_fkey;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_company_id_fkey;
DROP INDEX IF EXISTS clients_company_id_idx;
DROP INDEX IF EXISTS products_company_id_idx;
ALTER TABLE users DROP COLUMN IF EXISTS company_id;
ALTER TABLE clients DROP COLUMN IF EXISTS company_id;
ALTER TABLE products DROP COLUMN IF EXISTS company_id;
DROP TABLE IF EXISTS companies;
