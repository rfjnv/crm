-- Backfill: assign the orphaned "поспрес" client to Polygraph Business.
-- Deals are scoped through client.companyId (no companyId column on Deal itself),
-- so fixing the client is enough to make its deal(s) visible to Polygraph staff.

UPDATE clients
SET company_id = '44729528-e634-4d9a-9d7f-764902cdfea5'
WHERE id = 'b1cb859f-2b64-4a14-a357-76321d2832da'
  AND company_id IS NULL;

-- Sanity check after running:
-- SELECT id, company_name, company_id FROM clients WHERE id = 'b1cb859f-2b64-4a14-a357-76321d2832da';
