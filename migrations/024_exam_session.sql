-- Exam session: one sitting of a goal's held-out practice exam. The prediction
-- snapshot (exam_predictions) is frozen at start, BEFORE any answer is graded,
-- so the exam is an honest test of the mastery model's projections. Answers are
-- stored per item (exam_answers) as the learner works through the session, and
-- applied through the standard attempt pipeline only at finish. The computed
-- report is persisted on the session row so finish is idempotent by id.
CREATE TABLE IF NOT EXISTS exam_sessions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'in_progress', 'completed', 'abandoned')),
  item_order_json TEXT NOT NULL,
  report_json TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_exam_sessions_goal
  ON exam_sessions(goal_id, status);

-- Immutable per-item prediction, frozen at start_exam. predicted_correctness is
-- the model's pre-exam belief that the learner answers this item correctly;
-- facet_projection_json snapshots current + projected-at-due recall (and the
-- goal target) for the scope facets this item tests.
CREATE TABLE IF NOT EXISTS exam_predictions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  practice_item_id TEXT NOT NULL,
  predicted_correctness REAL NOT NULL,
  facet_projection_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, practice_item_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_predictions_session
  ON exam_predictions(session_id);

-- Per-item graded answer. grade_json is a serialized ResolvedGrade produced by
-- the caller (sidecar/CLI); no mastery is written until finish applies it
-- through apply_attempt, at which point attempt_id is backfilled.
CREATE TABLE IF NOT EXISTS exam_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  practice_item_id TEXT NOT NULL,
  answer_md TEXT,
  rubric_score INTEGER,
  correctness REAL,
  grade_json TEXT,
  attempt_id TEXT,
  answered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, practice_item_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_answers_session
  ON exam_answers(session_id);
