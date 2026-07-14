-- ING M8 (spec_source_ingestion_v2 §9.2, §11, §14): complete the source_exposure
-- instrumentation. Every provenance/span/citation surface records an exposure with
-- a `context` discriminator; M8 adds three new surfaces on top of migration 049's
-- viewer contexts:
--   * `tutor_citation`   — a tutor/QA answer citation chip opened the span (§9.2).
--   * `provenance_panel` — the entity provenance panel was opened for an entity.
--   * `conflict_review`  — a conflict-review side opened a cited span.
-- These exposures are what make the provenance-outcome analytics (§11) trustworthy:
-- coverage alone never proves the learner saw the source. Expanding a closed CHECK
-- requires the SQLite table-rebuild dance (mirrors migration 036).

PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_source_exposure_events_span;
DROP INDEX IF EXISTS idx_source_exposure_events_entity;

CREATE TABLE source_exposure_events_new (
  id TEXT PRIMARY KEY,
  context TEXT NOT NULL
    CHECK (context IN (
      'provenance', 'gate_diagnostic', 'registry_review', 'library', 'other',
      'tutor_citation', 'provenance_panel', 'conflict_review'
    )),
  extraction_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  revision_id TEXT,
  source_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  page INTEGER,
  locator TEXT,
  section_path_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

INSERT INTO source_exposure_events_new(
  id, context, extraction_id, span_id, revision_id, source_id,
  entity_type, entity_id, page, locator, section_path_json, created_at
)
SELECT
  id, context, extraction_id, span_id, revision_id, source_id,
  entity_type, entity_id, page, locator, section_path_json, created_at
FROM source_exposure_events;

DROP TABLE source_exposure_events;
ALTER TABLE source_exposure_events_new RENAME TO source_exposure_events;

CREATE INDEX idx_source_exposure_events_span ON source_exposure_events(extraction_id, span_id);
CREATE INDEX idx_source_exposure_events_entity ON source_exposure_events(entity_type, entity_id);

PRAGMA foreign_keys = ON;
