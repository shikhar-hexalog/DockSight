-- Four stages: Expected -> Pending in Uniware -> Manifested -> Closed (putaway).
-- Closed: Uniware's inventory received date (stock back). Manifested:
-- RETURN_ACKNOWLEDGED, or returned in Uniware but putaway not closed yet.

UPDATE returns
SET stage = 'CLOSED', stage_changed_at = inventory_received_at
WHERE inventory_received_at IS NOT NULL AND stage != 'CANCELLED';

UPDATE returns
SET stage = 'MANIFESTED', stage_changed_at = COALESCE(processed_at, last_synced_at)
WHERE inventory_received_at IS NULL AND stage != 'CANCELLED'
  AND (processed_at IS NOT NULL OR source_status = 'RETURN_ACKNOWLEDGED');

-- Keep the history readable: the old "Processed" stage is now "Closed".
UPDATE events SET payload = replace(payload, '"PROCESSED"', '"CLOSED"') WHERE payload LIKE '%"PROCESSED"%';
