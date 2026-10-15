-- A manifest is no longer scanned separately: submitting a receiving handover
-- makes one from its scans. batch_id links the two (the manifest reuses the
-- batch id). QC's AI result now records a product-match check.
ALTER TABLE return_manifests ADD COLUMN batch_id TEXT REFERENCES receiving_batches (id);

CREATE UNIQUE INDEX idx_manifests_batch ON return_manifests (batch_id);

ALTER TABLE qc_results RENAME COLUMN ai_suggestion TO ai_check;

-- Handovers already submitted get their manifest too.
INSERT INTO return_manifests (id, courier, created_by, created_at, status, closed_at, closed_by, batch_id)
SELECT b.id, b.courier, b.scanned_by, b.started_at, 'CLOSED', b.submitted_at, b.submitted_by, b.id
FROM receiving_batches b
WHERE b.kind = 'RECEIVE' AND b.status = 'SUBMITTED';

INSERT OR IGNORE INTO manifest_parcels (manifest_id, return_id, code, added_by, added_at)
SELECT rc.batch_id, rc.return_id, rc.normalized_code, rc.scanned_by, rc.scanned_at
FROM receipts rc JOIN return_manifests m ON m.batch_id = rc.batch_id
WHERE rc.return_id IS NOT NULL AND rc.result IN ('MATCHED', 'CANCELLED_RETURN')
ORDER BY rc.scanned_at;
