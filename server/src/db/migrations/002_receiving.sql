-- Every scan at the receiving desk, including ones that matched nothing.
-- id is made at the desk, so a scan sent twice (after a network drop) is
-- stored once. Exceptions (unexpected / cancelled parcels) stay open until
-- someone resolves them.
CREATE TABLE receipts (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL,
  normalized_code TEXT NOT NULL,
  return_id       TEXT REFERENCES returns (id) ON DELETE SET NULL,
  result          TEXT NOT NULL,
  scanned_by      TEXT NOT NULL,
  scanned_at      TEXT NOT NULL,
  recorded_at     TEXT NOT NULL,
  resolved_at     TEXT,
  resolved_by     TEXT,
  resolution_note TEXT
);

CREATE INDEX idx_receipts_scanned ON receipts (scanned_at);
CREATE INDEX idx_receipts_return ON receipts (return_id);
CREATE INDEX idx_receipts_code ON receipts (normalized_code);
CREATE INDEX idx_receipts_open ON receipts (result, resolved_at);
