-- Role-specific unit inventories + exam profiles for ING M4
-- (spec_source_ingestion_v2 §7, §4.2).
--
-- The cacheable inventory unit is the DocumentUnit (chapter/section), never the
-- whole source. Cache identity is the full UNIQUE key below: the same normalized
-- unit view under the same profile/schema/prompt/provider/model reuses a cached
-- inventory across collections and revisions at ZERO new tokens (§3.2 reuse
-- invariants). `inventory_profile` is part of that identity precisely because a
-- source's membership role can differ by collection; a richer `combined`
-- inventory may satisfy a narrower profile only when its schema version
-- guarantees the required fields (services.source_unit_inventory.profile_satisfies).
--
-- Inventory rows are CANDIDATES — never canonical facets, recipes, or learner
-- evidence (§7). Exam occurrences never gain semantic authority.
--
-- Migrations 037-039 are reserved by KM2/KM2b; ING M3 owns 040; ING M4 owns 041.

CREATE TABLE source_unit_inventories (
  id TEXT PRIMARY KEY,
  source_revision_id TEXT NOT NULL REFERENCES source_revisions(id),
  extraction_id TEXT NOT NULL REFERENCES source_extraction_runs(id),
  unit_id TEXT NOT NULL,
  unit_semantic_hash TEXT NOT NULL,
  inventory_profile TEXT NOT NULL,        -- semantic | practice | assessment | combined (app-validated)
  inventory_schema_version INTEGER NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  inventory_json TEXT NOT NULL,
  usage_json TEXT,                        -- per-call input/cached/output tokens (§6.2)
  created_at TEXT NOT NULL,
  UNIQUE(source_revision_id, unit_id, unit_semantic_hash, inventory_profile,
         inventory_schema_version, prompt_version, provider, model)
);

CREATE INDEX idx_source_unit_inventories_revision
  ON source_unit_inventories(source_revision_id);
CREATE INDEX idx_source_unit_inventories_semantic_hash
  ON source_unit_inventories(unit_semantic_hash);
CREATE INDEX idx_source_unit_inventories_extraction
  ON source_unit_inventories(extraction_id);

-- Deterministic exam profile aggregate (§7 exam profile; §4.2 use modes).
-- A pure function over the exam-unit inventories in scope produces aggregate
-- task-family/capability/representation/format counts + point/time emphasis
-- (1k-3k tokens) that M6 synthesis consumes. Its own table because the profile
-- is a materialized deterministic view collapsing same-syllabus-family
-- near-duplicate papers into ONE alignment vote — it is not 1:1 with any single
-- inventory row. `profile_hash` keys the deterministic identity of the inputs.
CREATE TABLE source_exam_profiles (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,               -- source_set | source_revision (app-validated)
  scope_id TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(scope_kind, scope_id, profile_hash)
);

CREATE INDEX idx_source_exam_profiles_scope
  ON source_exam_profiles(scope_kind, scope_id);

-- Exam use modes + past-paper metadata are chosen at unit selection (§4.2), so
-- they extend M3's unit-selection persistence. ADD COLUMN is not a CHECK change,
-- so no table rebuild is required. `exam_use_modes_json` maps unit_id ->
-- (held_out_evaluation | available_for_practice | blueprint_only);
-- `exam_paper_metadata_json` records administration year/syllabus/weighting for
-- the paper (one revision = one paper).
ALTER TABLE source_unit_selections ADD COLUMN exam_use_modes_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE source_unit_selections ADD COLUMN exam_paper_metadata_json TEXT NOT NULL DEFAULT '{}';
