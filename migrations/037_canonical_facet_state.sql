-- KM2 (knowledge-model §7.1): canonical shared facet belief state, the
-- capability-sliced certification ledger, and the pre-lock facet-merge map.
--
-- Purely additive. The legacy per-LO `evidence_facet_recall_state` (migration
-- 007) and `facet_uncertainty` (migration 012) are retained read-only for
-- frozen mvp-0.6 replay; these tables receive writes only under the mvp-0.7
-- algorithm_version. mvp-0.6 replay never touches them, so it reproduces
-- byte-identical derived state.

-- Canonical facet belief state, keyed on the post-alias/post-merge canonical
-- facet id and the observed capability (§7.1). `practice_item_id IS NULL` is the
-- shared aggregate row; a non-null id is a per-item marginal. SQLite UNIQUE
-- permits multiple NULLs, so the two scopes need separate partial unique indexes.
CREATE TABLE facet_recall_state (
  id TEXT PRIMARY KEY,
  facet_id TEXT NOT NULL,
  capability_key TEXT NOT NULL DEFAULT 'shared',
  practice_item_id TEXT,
  recall_alpha REAL NOT NULL,
  recall_beta REAL NOT NULL,
  recall_mean REAL NOT NULL,
  recall_variance REAL NOT NULL,
  independent_evidence_mass REAL NOT NULL DEFAULT 0,
  raw_coverage_mass REAL NOT NULL DEFAULT 0,
  last_observed_at TEXT,
  last_error_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  algorithm_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX facet_recall_aggregate
  ON facet_recall_state(facet_id, capability_key)
  WHERE practice_item_id IS NULL;
CREATE UNIQUE INDEX facet_recall_item
  ON facet_recall_state(facet_id, capability_key, practice_item_id)
  WHERE practice_item_id IS NOT NULL;

-- Replayable cache derived from immutable criterion observations: positive and
-- negative mass split by direct/embedded relationship, bounded certification
-- credit, and the set of independent surface/correlation groups seen so far
-- (JSON list) per (facet, capability). Not a new evidence source (§7.1).
CREATE TABLE facet_capability_evidence (
  facet_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  direct_positive_mass REAL NOT NULL DEFAULT 0,
  direct_negative_mass REAL NOT NULL DEFAULT 0,
  embedded_positive_mass REAL NOT NULL DEFAULT 0,
  embedded_negative_mass REAL NOT NULL DEFAULT 0,
  certification_credit REAL NOT NULL DEFAULT 0,
  independent_surface_groups_json TEXT NOT NULL DEFAULT '[]',
  algorithm_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(facet_id, capability)
);

-- Pre-lock reviewed facet merges only (§3.4). Replay and projections resolve
-- facet ids through aliases + this map; observations are never rewritten and no
-- beta mass is ever hand-migrated. Resolution is transitive to the terminal
-- survivor; a row that would create a cycle is rejected at write time (in the
-- repository), so this table can always be resolved to a fixed point.
CREATE TABLE facet_merges (
  retired_facet_id TEXT PRIMARY KEY,
  surviving_facet_id TEXT NOT NULL,
  merged_at TEXT NOT NULL,
  proposal_item_id TEXT,
  rationale TEXT
);
