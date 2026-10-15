-- Return manifests: received parcels grouped per courier, the step Uniware
-- calls Returns -> Manifest. A return is in at most one manifest.
CREATE TABLE return_manifests (
  id          TEXT PRIMARY KEY,
  courier     TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  status      TEXT NOT NULL,
  closed_at   TEXT,
  closed_by   TEXT
);

CREATE INDEX idx_manifests_status ON return_manifests (status, created_at);

CREATE TABLE manifest_parcels (
  manifest_id TEXT NOT NULL REFERENCES return_manifests (id) ON DELETE CASCADE,
  return_id   TEXT NOT NULL UNIQUE REFERENCES returns (id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  added_by    TEXT NOT NULL,
  added_at    TEXT NOT NULL,
  PRIMARY KEY (manifest_id, return_id)
);

-- QC: one result per return, graded per item. uniware_payload is the exact
-- returns/complete body; pushed_at stays NULL while the push is off.
CREATE TABLE qc_results (
  id              TEXT PRIMARY KEY,
  return_id       TEXT NOT NULL UNIQUE REFERENCES returns (id) ON DELETE CASCADE,
  qc_by           TEXT NOT NULL,
  qc_at           TEXT NOT NULL,
  shelf_code      TEXT NOT NULL,
  photo           TEXT,
  ai_suggestion   TEXT,
  uniware_payload TEXT NOT NULL,
  pushed_at       TEXT
);

CREATE INDEX idx_qc_at ON qc_results (qc_at);

CREATE TABLE qc_items (
  qc_id                TEXT NOT NULL REFERENCES qc_results (id) ON DELETE CASCADE,
  sale_order_item_code TEXT NOT NULL,
  grade                TEXT NOT NULL,
  reason               TEXT,
  PRIMARY KEY (qc_id, sale_order_item_code)
);
