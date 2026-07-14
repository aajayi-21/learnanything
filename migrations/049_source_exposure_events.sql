-- Source-exposure telemetry (spec_source_ingestion_v2 §9.2, §14): EVERY
-- Open-in-source view records that the learner was shown a specific source span.
-- This is read/exposure telemetry, distinct from content_events (which records
-- curriculum mutations). One row per view. `context` says which surface opened
-- the span (provenance panel, gate diagnostic, registry review); `entity_type`/
-- `entity_id` name the curriculum entity whose provenance was being inspected
-- (nullable — a span can be opened without an entity anchor).
CREATE TABLE source_exposure_events (
  id TEXT PRIMARY KEY,
  context TEXT NOT NULL
    CHECK (context IN ('provenance', 'gate_diagnostic', 'registry_review', 'library', 'other')),
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

CREATE INDEX idx_source_exposure_events_span ON source_exposure_events(extraction_id, span_id);
CREATE INDEX idx_source_exposure_events_entity ON source_exposure_events(entity_type, entity_id);
