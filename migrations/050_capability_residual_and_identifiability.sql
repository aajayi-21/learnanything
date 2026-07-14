-- KM5 (knowledge-model §4.2 / §11.3): capability-residual activation state and
-- the pre-first-practice identifiability watermark.
--
-- Purely additive. Both tables are mvp-0.7-only derived/bookkeeping state; the
-- mvp-0.6 frozen replay path never reads or writes them, so legacy vaults
-- reproduce byte-identical derived state. Residual activation ships behind
-- [capabilities] config, DEFAULT OFF — with the feature off the projection never
-- writes to `capability_residual_state`, so the table stays empty and rebuild
-- determinism is unaffected either way.
--
-- 048 (ingest_batch_priority) and 049 (source_exposure_events) are the parallel
-- M6-UX track; KM5 lands on 050.

-- §4.2 lazy capability-residual activation. A row keys a learner-specific
-- residual belief for one (facet, capability) under the shared facet parent.
-- `active` records whether the residual is currently activated (a closed
-- diagnostic episode demonstrated divergence, or persistent capability-sliced
-- residual disagreement crossed the config thresholds). This is learner-model
-- state, NOT a curriculum mutation or identity-lock event, and it is DERIVED in
-- the projection fold (replace-on-rebuild), so replay reproduces it exactly.
-- `residual_*` is the shrinkage-blended capability belief (shared parent as
-- prior); `parent_*` is the pooled shared-parent belief the residual departs
-- from. No SQL CHECK on `activation_reason` so it stays app-extensible.
CREATE TABLE IF NOT EXISTS capability_residual_state (
  id TEXT PRIMARY KEY,
  facet_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  activation_reason TEXT,
  residual_alpha REAL NOT NULL,
  residual_beta REAL NOT NULL,
  residual_mean REAL NOT NULL,
  parent_alpha REAL NOT NULL,
  parent_beta REAL NOT NULL,
  parent_mean REAL NOT NULL,
  divergence REAL NOT NULL DEFAULT 0,
  independent_groups INTEGER NOT NULL DEFAULT 0,
  independent_mass REAL NOT NULL DEFAULT 0,
  algorithm_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(facet_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_capability_residual_active
  ON capability_residual_state(active, facet_id);

-- §11.3 pre-first-practice identifiability doctor watermark. One row per subject
-- records the registry hash last analyzed and how many non-identifiable
-- distinctions were open at that time, so the doctor re-runs graph-
-- identifiability only when a subject's registry changed since the last check
-- (before evidence accrues against unlocked distinctions).
CREATE TABLE IF NOT EXISTS subject_identifiability_watermarks (
  subject_id TEXT PRIMARY KEY,
  registry_hash TEXT NOT NULL,
  finding_count INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL
);
