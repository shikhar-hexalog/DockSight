-- Parcels whose order was cancelled after they were put on a manifest.
-- One row per shipping package; status moves OPEN -> PULLED or MISSED.
CREATE TABLE dispatch_holds (
  id                  TEXT PRIMARY KEY,
  account             TEXT NOT NULL,
  sale_order_code     TEXT NOT NULL,
  package_code        TEXT NOT NULL,
  tracking_number     TEXT,
  manifest_code       TEXT,
  courier             TEXT,
  item_count          INTEGER NOT NULL DEFAULT 0,
  first_item_name     TEXT,
  cancellation_reason TEXT,
  cancelled_at        TEXT NOT NULL,
  detected_at         TEXT NOT NULL,
  status              TEXT NOT NULL,
  pulled_at           TEXT,
  pulled_by           TEXT,
  pulled_via          TEXT,
  missed_at           TEXT,
  UNIQUE (account, package_code)
);

CREATE INDEX idx_holds_status ON dispatch_holds (status);
CREATE INDEX idx_holds_tracking ON dispatch_holds (tracking_number);

-- Every scan at the handover check. id is made at the desk, so a check sent
-- twice is stored once.
CREATE TABLE handover_checks (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  result      TEXT NOT NULL,
  hold_id     TEXT REFERENCES dispatch_holds (id) ON DELETE SET NULL,
  checked_by  TEXT NOT NULL,
  checked_at  TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_handover_checked ON handover_checks (checked_at);
