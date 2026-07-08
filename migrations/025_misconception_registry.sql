-- Content-bearing misconceptions (spec_misconception_diagnostics.md §1).
-- A misconception is a normalized, first-class belief record scoped to a
-- learning object; error_events remain the raw per-attempt evidence and now
-- carry a nullable link back to the registry row that normalized them.
CREATE TABLE IF NOT EXISTS misconceptions (
  id TEXT PRIMARY KEY,
  learning_object_id TEXT NOT NULL,
  concept_id TEXT,
  statement TEXT NOT NULL,
  signature TEXT,
  facet_ids_json TEXT,
  severity REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolving', 'resolved')),
  source_error_event_ids_json TEXT,
  created_at TEXT,
  updated_at TEXT,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_misconceptions_lo_status
  ON misconceptions(learning_object_id, status);
CREATE INDEX IF NOT EXISTS idx_misconceptions_concept
  ON misconceptions(concept_id);

-- error_events gains the normalized-belief link plus the two structured grader
-- fields (spec §2.1): the belief in learner-model terms and the answer a holder
-- of the belief would give. Nullable for legacy rows and non-misconception errors.
ALTER TABLE error_events ADD COLUMN misconception_id TEXT;
ALTER TABLE error_events ADD COLUMN misconception_statement TEXT;
ALTER TABLE error_events ADD COLUMN misconception_consistent_answer TEXT;

-- Estimated (not binary) discrimination of an item's keyed fatal error against a
-- misconception (spec §1.3). Beta posteriors over sensitivity (fire | belief) and
-- specificity (no-fire | clean); consumers read lower bounds, never bare means.
CREATE TABLE IF NOT EXISTS item_misconception_discrimination (
  practice_item_id TEXT NOT NULL,
  misconception_id TEXT NOT NULL,
  sensitivity_alpha REAL NOT NULL DEFAULT 1,
  sensitivity_beta REAL NOT NULL DEFAULT 1,
  specificity_alpha REAL NOT NULL DEFAULT 1,
  specificity_beta REAL NOT NULL DEFAULT 1,
  n_planted_trials INTEGER NOT NULL DEFAULT 0,
  n_clean_trials INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  updated_at TEXT,
  PRIMARY KEY (practice_item_id, misconception_id)
);

CREATE INDEX IF NOT EXISTS idx_item_mc_discrimination_misconception
  ON item_misconception_discrimination(misconception_id);
