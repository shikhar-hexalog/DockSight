-- "Received at our dock" now only comes from our own records: desk scans and
-- the warehouse's receiving sheet. Uniware's courier delivered date no longer
-- counts, so returns that were Pending only because of it go back to Expected.

ALTER TABLE returns ADD COLUMN dock_received_source TEXT;

UPDATE returns SET dock_received_source = 'dock' WHERE dock_received_at IS NOT NULL;

UPDATE returns
SET stage = 'EXPECTED', stage_changed_at = COALESCE(source_created_at, stage_changed_at)
WHERE stage = 'RECEIVED' AND dock_received_at IS NULL;

-- Rows imported from a receiving sheet carry what the sheet said.
ALTER TABLE receipts ADD COLUMN source TEXT NOT NULL DEFAULT 'dock';
ALTER TABLE receipts ADD COLUMN vehicle_no TEXT;
ALTER TABLE receipts ADD COLUMN sheet_courier TEXT;
ALTER TABLE receipts ADD COLUMN sheet_type TEXT;
ALTER TABLE receipts ADD COLUMN remarks TEXT;
