-- Quick-add queue priority (spec_source_ingestion_v2 §1): a Quick-add build
-- batch must drain ahead of bulk import/inventory batches so a single pasted
-- source reaches a study map "between checkpoints" instead of waiting behind a
-- large backlog. The drain (Repository.claim_next_ingest_job) selects the next
-- eligible job ordered by b.priority DESC first, then FIFO by created_at. Higher
-- priority wins; the default 0 preserves existing FIFO behaviour for every
-- batch enqueued before this migration.
ALTER TABLE ingest_batches ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_ingest_batches_priority ON ingest_batches(priority DESC, created_at);
