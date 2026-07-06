-- One-tap "was this follow-up useful?" labels for the follow-up gate fitter
-- (Fable's-take item 2). attempt_id is the rated attempt (the follow-up
-- attempt itself); gate_attempt_id is the attempt whose gate decision queued
-- that follow-up, resolved at write time so the fitter can join
-- attempt_surprise.gate_diagnostics_json directly. Sparse, re-ratable
-- (upsert), carries its own provenance/timestamps.
CREATE TABLE IF NOT EXISTS followup_ratings (
  attempt_id TEXT PRIMARY KEY REFERENCES practice_attempts(id) ON DELETE CASCADE,
  gate_attempt_id TEXT REFERENCES practice_attempts(id) ON DELETE SET NULL,
  useful INTEGER NOT NULL CHECK (useful IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'user',
  rated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_followup_ratings_gate_attempt
  ON followup_ratings(gate_attempt_id);
