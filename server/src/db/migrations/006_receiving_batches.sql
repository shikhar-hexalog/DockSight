-- Receiving batches: one per courier handover. Arrival is recorded per scan;
-- a batch is submitted (locked) once a photo of the handover sheet, signed
-- by our worker and the courier rider, is uploaded.
CREATE TABLE receiving_batches (
  id            TEXT PRIMARY KEY,
  courier       TEXT NOT NULL,
  vehicle_no    TEXT,
  scanned_by    TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  status        TEXT NOT NULL,
  courier_count INTEGER,
  -- File name under data/uploads.
  signed_sheet  TEXT,
  submitted_at  TEXT,
  submitted_by  TEXT,
  recorded_at   TEXT NOT NULL
);

CREATE INDEX idx_batches_status ON receiving_batches (status, started_at);

-- Each scan can carry the parcel's condition, a note and a photo.
ALTER TABLE receipts ADD COLUMN batch_id TEXT REFERENCES receiving_batches (id);
ALTER TABLE receipts ADD COLUMN condition TEXT;
ALTER TABLE receipts ADD COLUMN condition_note TEXT;
ALTER TABLE receipts ADD COLUMN condition_photo TEXT;
ALTER TABLE receipts ADD COLUMN condition_updated_at TEXT;

CREATE INDEX idx_receipts_batch ON receipts (batch_id);
