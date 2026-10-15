-- Customer emails sent when a dispatch handover is submitted: one row per
-- handover, so the emails go out once and the Dispatch page can show it.
CREATE TABLE dispatch_notices (
  batch_id    TEXT PRIMARY KEY REFERENCES receiving_batches (id),
  courier     TEXT NOT NULL,
  recipient   TEXT,
  sent        INTEGER NOT NULL,
  failed      INTEGER NOT NULL,
  error       TEXT,
  notified_at TEXT NOT NULL
);
