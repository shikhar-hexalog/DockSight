-- Dispatch handovers use the same batches as receiving: who, courier,
-- vehicle, the rider's count and the signed pickup sheet.
ALTER TABLE receiving_batches ADD COLUMN kind TEXT NOT NULL DEFAULT 'RECEIVE';

ALTER TABLE handover_checks ADD COLUMN batch_id TEXT REFERENCES receiving_batches (id);

CREATE INDEX idx_handover_batch ON handover_checks (batch_id);
