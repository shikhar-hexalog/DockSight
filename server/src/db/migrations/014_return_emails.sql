-- "We've received your return" emails, one per matched dock scan of a
-- submitted returns handover, so each is sent once (like dispatch_emails).
CREATE TABLE return_emails (
  receipt_id TEXT PRIMARY KEY REFERENCES receipts (id),
  batch_id   TEXT NOT NULL REFERENCES receiving_batches (id),
  sent_at    TEXT NOT NULL
);

CREATE INDEX idx_return_emails_batch ON return_emails (batch_id);

-- Notices now cover returns handovers too.
ALTER TABLE dispatch_notices ADD COLUMN kind TEXT NOT NULL DEFAULT 'DISPATCH';
