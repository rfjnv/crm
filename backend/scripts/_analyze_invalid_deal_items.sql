-- =============================================================================
-- READ-ONLY: Invalid deal_items analysis (quantity/price both zero)
-- Maps app fields: requested_qty -> "quantity", price -> price
-- =============================================================================
-- Invalid row: both qty and price are zero (NULL treated as 0 for classification)
-- =============================================================================

-- Count invalid deal_items rows
SELECT COUNT(*) AS invalid_item_rows
FROM deal_items di
WHERE COALESCE(di.requested_qty, 0) = 0
  AND COALESCE(di.price, 0) = 0;

-- -----------------------------------------------------------------------------
-- safeToDelete: deal has >= 1 invalid item AND >= 1 valid item
-- -----------------------------------------------------------------------------
WITH item_class AS (
  SELECT
    di.deal_id,
    di.id AS item_id,
    CASE
      WHEN COALESCE(di.requested_qty, 0) = 0 AND COALESCE(di.price, 0) = 0 THEN 1
      ELSE 0
    END AS is_invalid,
    CASE
      WHEN COALESCE(di.requested_qty, 0) > 0 OR COALESCE(di.price, 0) > 0 THEN 1
      ELSE 0
    END AS is_valid
  FROM deal_items di
),
deal_agg AS (
  SELECT
    deal_id,
    SUM(is_invalid)::int AS invalid_item_count,
    SUM(is_valid)::int AS valid_item_count
  FROM item_class
  GROUP BY deal_id
)
SELECT
  d.id AS deal_id,
  c.company_name AS client_name,
  d.title AS deal_name,
  da.invalid_item_count AS count_invalid_items
FROM deal_agg da
JOIN deals d ON d.id = da.deal_id
JOIN clients c ON c.id = d.client_id
WHERE da.invalid_item_count > 0
  AND da.valid_item_count > 0
ORDER BY da.invalid_item_count DESC, d.title;

-- -----------------------------------------------------------------------------
-- manualReview (only invalid items): deal has items but ALL are invalid
-- -----------------------------------------------------------------------------
WITH item_class AS (
  SELECT
    di.deal_id,
    CASE
      WHEN COALESCE(di.requested_qty, 0) = 0 AND COALESCE(di.price, 0) = 0 THEN 1
      ELSE 0
    END AS is_invalid,
    CASE
      WHEN COALESCE(di.requested_qty, 0) > 0 OR COALESCE(di.price, 0) > 0 THEN 1
      ELSE 0
    END AS is_valid
  FROM deal_items di
),
deal_agg AS (
  SELECT
    deal_id,
    COUNT(*)::int AS total_items,
    SUM(is_invalid)::int AS invalid_item_count,
    SUM(is_valid)::int AS valid_item_count
  FROM item_class
  GROUP BY deal_id
)
SELECT
  d.id AS deal_id,
  c.company_name AS client_name,
  d.title AS deal_name,
  'only invalid items'::text AS reason
FROM deal_agg da
JOIN deals d ON d.id = da.deal_id
JOIN clients c ON c.id = d.client_id
WHERE da.total_items > 0
  AND da.valid_item_count = 0
ORDER BY d.title;

-- -----------------------------------------------------------------------------
-- manualReview (no items): deal has zero deal_items
-- -----------------------------------------------------------------------------
SELECT
  d.id AS deal_id,
  c.company_name AS client_name,
  d.title AS deal_name,
  'no items'::text AS reason
FROM deals d
JOIN clients c ON c.id = d.client_id
WHERE NOT EXISTS (SELECT 1 FROM deal_items di WHERE di.deal_id = d.id)
ORDER BY d.title;

-- -----------------------------------------------------------------------------
-- Spot-check example titles (adjust ILIKE if titles differ slightly)
-- -----------------------------------------------------------------------------
SELECT d.id, d.title, c.company_name
FROM deals d
JOIN clients c ON c.id = d.client_id
WHERE d.title ILIKE '%фойл трейдинг%17.05.2024%'
   OR d.title ILIKE '%принт лайн%сверка%'
   OR d.title ILIKE '%само принт%03.03.2026%';

-- =============================================================================
-- Part 3 — DELETE (DO NOT RUN until reviewed) — safeToDelete deals only
-- =============================================================================
-- DELETE FROM deal_items di
-- USING deals d
-- WHERE di.deal_id = d.id
--   AND COALESCE(di.requested_qty, 0) = 0
--   AND COALESCE(di.price, 0) = 0
--   AND EXISTS (
--     SELECT 1
--     FROM deal_items di2
--     WHERE di2.deal_id = di.deal_id
--       AND (COALESCE(di2.requested_qty, 0) > 0 OR COALESCE(di2.price, 0) > 0)
--   );
