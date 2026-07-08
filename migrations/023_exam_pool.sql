-- Exam pool: items reserved for a goal's held-out practice exam so ordinary
-- practice cannot contaminate them. A reservation is releasable per goal
-- (released_at set when the exam finishes and the items rejoin practice). An
-- item can sit in at most one *unreleased* pool at a time (partial unique
-- index). facet_id records the primary scope facet the item was reserved to
-- cover; difficulty_stratum is the coarse difficulty bucket used for
-- stratification. Both are provenance for the reservation blueprint, not
-- constraints.
CREATE TABLE IF NOT EXISTS exam_pool_items (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  practice_item_id TEXT NOT NULL,
  facet_id TEXT,
  difficulty_stratum TEXT,
  reserved_at TEXT NOT NULL,
  released_at TEXT
);

-- An item can be in at most one unreleased pool across all goals.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_pool_unreleased_item
  ON exam_pool_items(practice_item_id)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exam_pool_goal
  ON exam_pool_items(goal_id, released_at);
