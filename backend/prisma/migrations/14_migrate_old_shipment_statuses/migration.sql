-- Migrate old workflow statuses to new workflow
-- READY_FOR_SHIPMENT → READY_FOR_LOADING (these deals were already admin-approved)
-- SHIPMENT_ON_HOLD → READY_FOR_LOADING (release hold and move to new flow)
-- ADMIN_APPROVED → PENDING_ADMIN (re-route through new admin approval)

UPDATE deals SET status = 'READY_FOR_LOADING' WHERE status = 'READY_FOR_SHIPMENT' AND is_archived = false;
UPDATE deals SET status = 'READY_FOR_LOADING' WHERE status = 'SHIPMENT_ON_HOLD' AND is_archived = false;
UPDATE deals SET status = 'PENDING_ADMIN' WHERE status = 'ADMIN_APPROVED' AND is_archived = false;
