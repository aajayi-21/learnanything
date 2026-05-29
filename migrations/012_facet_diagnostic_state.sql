CREATE TABLE IF NOT EXISTS facet_uncertainty (
  id TEXT PRIMARY KEY,
  learning_object_id TEXT NOT NULL,
  facet_id TEXT NOT NULL,
  hypothesis_marginal TEXT NOT NULL,
  uncertainty REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolving', 'resolved')),
  opened_by_attempt_id TEXT NOT NULL REFERENCES practice_attempts(id) ON DELETE CASCADE,
  opened_reason TEXT NOT NULL CHECK (
    opened_reason IN ('low_facet_outcome', 'hedged_confidence', 'repeated_facet_failure')
  ),
  last_evidence_at TEXT,
  algorithm_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (learning_object_id, facet_id)
);

CREATE INDEX IF NOT EXISTS idx_facet_uncertainty_lo_status
  ON facet_uncertainty(learning_object_id, status, uncertainty DESC);

ALTER TABLE grading_evidence ADD COLUMN learner_confidence TEXT;

CREATE TABLE decision_features_new (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  decision_type TEXT NOT NULL CHECK (decision_type IN ('selection', 'probe', 'grading', 'followup')),
  ability_vector_json TEXT NOT NULL,
  item_demand_vector_json TEXT,
  context_json TEXT,
  algorithm_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (decision_id, decision_type)
);

INSERT INTO decision_features_new(
  id, decision_id, decision_type, ability_vector_json, item_demand_vector_json,
  context_json, algorithm_version, created_at
)
SELECT
  id, decision_id, decision_type, ability_vector_json, item_demand_vector_json,
  context_json, algorithm_version, created_at
FROM decision_features;

DROP TABLE decision_features;
ALTER TABLE decision_features_new RENAME TO decision_features;

CREATE INDEX IF NOT EXISTS idx_decision_features_type_time
  ON decision_features(decision_type, created_at);
