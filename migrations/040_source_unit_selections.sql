-- Unit selection persistence for ING M3 (spec_source_ingestion_v2 §5.3).
--
-- Per (artifact, revision, extraction) the learner's chosen units plus optional
-- boundary overrides (merge-with-next / split-at-heading) layered over the
-- ExtractionRun. Selections survive re-extraction by deterministic re-anchoring
-- (services/source_unit_selection.py): anything unresolved lands in
-- needs_review_json for review and is never silently dropped.
--
-- KM2 reserves migrations 037-039; ING M3 owns 040.

CREATE TABLE source_unit_selections (
  extraction_id TEXT PRIMARY KEY REFERENCES source_extraction_runs(id),
  source_id TEXT REFERENCES source_artifacts(id),
  revision_id TEXT REFERENCES source_revisions(id),
  selected_unit_ids_json TEXT NOT NULL DEFAULT '[]',
  boundary_overrides_json TEXT NOT NULL DEFAULT '[]',
  needs_review_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_source_unit_selections_revision ON source_unit_selections(revision_id);
CREATE INDEX idx_source_unit_selections_source ON source_unit_selections(source_id);
