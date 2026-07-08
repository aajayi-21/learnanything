-- Primed attempts: retries launched from the feedback screen's source-review
-- panel right after re-reading the canonical source. Orthogonal to
-- attempt_type (a primed attempt can be any type), so this is a plain column
-- add — no CHECK rebuild needed. Primed attempts get an IRT easiness shift in
-- the mastery update and do not advance last_evidence_at.
ALTER TABLE practice_attempts ADD COLUMN primed INTEGER NOT NULL DEFAULT 0;
