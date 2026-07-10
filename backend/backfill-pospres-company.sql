-- Backfill: assign the orphaned "поспрес" client to Polygraph Business.
-- Deals are scoped through client.companyId (no companyId column on Deal itself),
-- so fixing the client is enough to make its deal(s) visible to Polygraph staff.

-- NOTE: company_id here is the production companies.id for Polygraph Business
-- (a56fddde-da93-4c2b-a5b5-0139fbc1faf7), NOT the local dev-DB id — verify with
-- `SELECT id, name FROM companies;` before running against a different environment.
UPDATE clients
SET company_id = 'a56fddde-da93-4c2b-a5b5-0139fbc1faf7'
WHERE id = 'b1cb859f-2b64-4a14-a357-76321d2832da'
  AND company_id IS NULL;

-- Sanity check after running:
-- SELECT id, company_name, company_id FROM clients WHERE id = 'b1cb859f-2b64-4a14-a357-76321d2832da';
