-- Handovers notified before per-parcel tracking: their cleared parcels were
-- all emailed, so mark them, or the retry would email those customers again.
INSERT OR IGNORE INTO dispatch_emails (check_id, batch_id, sent_at)
SELECT hc.id, hc.batch_id, n.notified_at
FROM handover_checks hc
JOIN dispatch_notices n ON n.batch_id = hc.batch_id
WHERE hc.result = 'CLEAR' AND n.sent > 0 AND n.failed = 0;
