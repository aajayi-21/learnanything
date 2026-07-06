-- Fitted-parameter store (architecture_pivot.md Stage 1).
-- Versioned home for parameter sets learned from the learner's own logs
-- (FSRS weights, follow-up gate logistic weights, future scopes). Fitted sets
-- are INPUTS to replay, not derived state: rebuild-derived-state must never
-- clear this table. At most one active row per scope, enforced transactionally
-- in the repository (deactivate-then-insert); history rows are never deleted
-- so every replay is auditable back to the parameter set that produced it.
CREATE TABLE IF NOT EXISTS fitted_parameters (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  params_json TEXT NOT NULL,
  fitted_at TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  training_rows_count INTEGER NOT NULL,
  training_data_through TEXT,
  metrics_json TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  deactivated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fitted_parameters_scope_active
  ON fitted_parameters(scope, active, fitted_at DESC);

-- Per-item empirical-Bayes difficulty posterior (Fable's-take item 5). The
-- authored vault difficulty stays the prior mean; this row is the posterior
-- that shrinks toward it as evidence accumulates. Derived state: cleared by
-- reset_learning_object_derived_state and rebuilt by replay.
CREATE TABLE IF NOT EXISTS item_parameter_state (
  practice_item_id TEXT PRIMARY KEY,
  b_mean REAL NOT NULL,
  b_var REAL NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  algorithm_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
