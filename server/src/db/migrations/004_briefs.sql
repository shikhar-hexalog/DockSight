-- Briefs written by the AI: the morning brief and shift handover notes.
CREATE TABLE briefs (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  -- Which scheduled slot it was for (e.g. "2026-10-14 09:00"), so each runs once.
  slot       TEXT,
  provider   TEXT NOT NULL,
  content    TEXT NOT NULL,
  delivery   TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_briefs_created ON briefs (created_at DESC);
CREATE UNIQUE INDEX idx_briefs_slot ON briefs (kind, slot) WHERE slot IS NOT NULL;
