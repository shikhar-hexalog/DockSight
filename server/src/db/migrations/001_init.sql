-- One row per return (RTO or customer return) pulled from Uniware.
-- Uniware stays the source of truth for its own fields; stage and the
-- columns after it belong to this app.
-- account is our key for the Uniware login it came from (UNICOMMERCE_ACCOUNT_<key>_*).
CREATE TABLE returns (
  id                  TEXT PRIMARY KEY,
  account             TEXT NOT NULL,
  facility_code       TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT 'UNIWARE',
  source_code         TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('RTO', 'CIR')),
  source_status       TEXT,
  sale_order_code     TEXT,
  shipment_code       TEXT,
  reverse_pickup_code TEXT,
  courier             TEXT,
  tracking_number     TEXT,
  rto_courier         TEXT,
  rto_tracking_number TEXT,
  rto_reason          TEXT,
  putaway_code        TEXT,
  source_created_at   TEXT,
  delivered_at          TEXT,
  inventory_received_at TEXT,
  completed_at          TEXT,
  -- When Uniware finished processing it (see processedAt in the mapper).
  processed_at        TEXT,
  source_hash         TEXT NOT NULL,
  -- First scan at our receiving desk: the real arrival time.
  dock_received_at    TEXT,
  dock_received_by    TEXT,
  stage               TEXT NOT NULL,
  stage_changed_at    TEXT NOT NULL,
  first_synced_at     TEXT NOT NULL,
  last_synced_at      TEXT NOT NULL,
  UNIQUE (account, type, source_code)
);

CREATE INDEX idx_returns_stage ON returns (stage, stage_changed_at);
CREATE INDEX idx_returns_tracking ON returns (tracking_number);
CREATE INDEX idx_returns_rto_tracking ON returns (rto_tracking_number);
CREATE INDEX idx_returns_shipment ON returns (shipment_code);
CREATE INDEX idx_returns_reverse_pickup ON returns (reverse_pickup_code);
CREATE INDEX idx_returns_sale_order ON returns (sale_order_code);
CREATE INDEX idx_returns_processed ON returns (processed_at);
CREATE INDEX idx_returns_dock_received ON returns (dock_received_at);

CREATE TABLE return_items (
  id                   TEXT PRIMARY KEY,
  return_id            TEXT NOT NULL REFERENCES returns (id) ON DELETE CASCADE,
  sale_order_item_code TEXT NOT NULL,
  sku_code             TEXT,
  item_name            TEXT,
  source_status        TEXT,
  inventory_type       TEXT,
  return_reason        TEXT,
  putaway_qc_comment   TEXT,
  return_remarks       TEXT,
  catalog_image_url    TEXT,
  courier_status       TEXT,
  tracking_status      TEXT,
  UNIQUE (return_id, sale_order_item_code)
);

CREATE INDEX idx_items_sku ON return_items (sku_code);

-- Append-only history of everything that happens to a return.
-- client_action_id makes writes from the phone's offline outbox idempotent:
-- the same action sent twice is stored once.
CREATE TABLE events (
  id               TEXT PRIMARY KEY,
  return_id        TEXT NOT NULL REFERENCES returns (id) ON DELETE CASCADE,
  item_id          TEXT REFERENCES return_items (id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  actor            TEXT NOT NULL,
  payload          TEXT,
  client_action_id TEXT UNIQUE,
  occurred_at      TEXT NOT NULL,
  recorded_at      TEXT NOT NULL
);

CREATE INDEX idx_events_return ON events (return_id, occurred_at);

CREATE TABLE sync_runs (
  id          TEXT PRIMARY KEY,
  account     TEXT,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  window_from TEXT,
  window_to   TEXT,
  fetched     INTEGER NOT NULL DEFAULT 0,
  created     INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  unchanged   INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE INDEX idx_sync_runs_started ON sync_runs (started_at DESC);

-- How far incremental sync has read, per account and return type.
CREATE TABLE sync_cursors (
  account         TEXT NOT NULL,
  type            TEXT NOT NULL,
  last_updated_to TEXT NOT NULL,
  PRIMARY KEY (account, type)
);
