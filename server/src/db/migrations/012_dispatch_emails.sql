-- One row per parcel whose dispatch email went out, so each parcel is
-- emailed once: retries, late-arriving scans and outages only send the rest.
CREATE TABLE dispatch_emails (
  check_id TEXT PRIMARY KEY REFERENCES handover_checks (id),
  batch_id TEXT NOT NULL REFERENCES receiving_batches (id),
  sent_at  TEXT NOT NULL
);

CREATE INDEX idx_dispatch_emails_batch ON dispatch_emails (batch_id);
