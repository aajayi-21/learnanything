-- Tutor Q&A ("ask") events. One row per learner question + tutor answer, in
-- one of three contexts: reading a note (library), mid-attempt (practice), or
-- post-grade (feedback). Facets/type come from the tutor classification;
-- hint_equivalent marks substantive mid-attempt questions that dampen the next
-- attempt's evidence through the existing hints pipeline; leak_suspected is
-- telemetry from the practice-context answer-leak check. rating is the
-- learner's 1 (useful) / 0 (not useful) thumb, NULL until rated.
CREATE TABLE IF NOT EXISTS question_events (
  id TEXT PRIMARY KEY,
  context TEXT NOT NULL CHECK (context IN ('library', 'practice', 'feedback')),
  note_id TEXT,
  practice_item_id TEXT,
  attempt_id TEXT,
  session_id TEXT,
  question_md TEXT NOT NULL,
  answer_md TEXT,
  question_type TEXT CHECK (
    question_type IN ('clarification', 'prerequisite', 'mechanism', 'strategy', 'verification', 'other')
  ),
  facets_json TEXT,
  hint_equivalent INTEGER NOT NULL DEFAULT 0,
  leak_suspected INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  seconds_into_attempt REAL,
  provider TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_question_events_item_session
  ON question_events(practice_item_id, session_id);

CREATE INDEX IF NOT EXISTS idx_question_events_note
  ON question_events(note_id);
