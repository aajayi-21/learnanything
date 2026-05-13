# Open Questions

Questions still unresolved after the spec review pass. Grouped by area, marked **Blocking** (must answer before implementation can proceed in that slice), **Soon** (can scaffold first, must answer before that subsystem ships), or **Defer** (decision can wait for v0.2+).

Each question has my recommended answer in *italics*. Treat these as proposals to react to, not decisions.

---

## A. Scheduler & elicitation

### A1. Heuristic surrogate functional form — **Blocking** (Layer 4)

The spec says the local surrogate predicts `P(score_bucket, error_type, confidence_bucket, latency_bucket, hints_bucket | z, q)` from "current mastery, item difficulty, recent attempts, error impacts, confidence, latency, hints." But the concrete functional form is unspecified. Without it, the heuristic-EIG scorer can't be implemented and scheduler goldens can't be authored.

*Recommendation:* Factorize as `P(o | z, q) = P(score | z,q) · P(error | score, z,q) · P(confidence | score, z,q) · P(latency | score, z,q) · P(hints | score, z,q)`. Each factor is a small parametric form (logistic over `lo_mastery[axis] · weights[axis] − difficulty`, with axis weights from PI `mastery_weights`). Calibrate the parameters from a few hundred seeded golden attempts in the sample vault, then refine from the user's own attempts after N=200. Document the exact form and parameter table in §16, version it as part of `algorithm_version`.

### A2. Cross-LO update propagation — **Blocking**

An attempt is logged against one Practice Item → one Learning Object. But the prompt may legitimately exercise prerequisite LOs (a PCA item touches SVD). Does evidence propagate up the prerequisite DAG?

*Recommendation:* Yes, but only as an **uncertainty update**, not a mean update. A successful PCA attempt does not raise SVD mastery (the learner might have memorized PCA without understanding SVD), but it can *lower variance* on SVD beliefs by a small factor. Failure propagates as a mean *and* variance update (failing PCA suggests SVD understanding is weaker than estimated). Configurable per-LO via `propagate_failure_to_prereqs: true` (default), `propagate_success_to_prereqs: variance_only` (default).

### A3. Axis correlation — **Blocking**

The config says `assume_independent_axes = false` but the EMA update treats each axis independently. If a `transfer` item dings both `understanding` and `generalization`, do we update each from its own evidence, or compute one update and split it?

*Recommendation:* Sum-to-one `mastery_weights` on each PI act as the split. The single observed score produces one `gain` value; each axis update uses `effective_alpha = alpha · mastery_weights[axis] · grader_confidence · hint_dampening` against that same gain. This prevents double-counting because the *update magnitude* is split, even though each axis carries its own running estimate. Mention this explicitly in §16 next to `update_mastery`.

### A4. Disguised-retest / resolved-misconception queue load cap — **Soon**

A mature vault accumulates resolved misconceptions all wanting periodic disguised retests. Without a cap, the queue gets eaten by a long tail.

*Recommendation:* Per-session cap: at most 1 disguised retest per session, prioritized by oldest-since-last-disguised-retest among resolved misconceptions whose contradicted LO is in scope for an active goal. Retest interval grows geometrically (14d → 30d → 60d → 120d) after each successful disguised retest, capped at 365d. A failed disguised retest reopens the misconception and resets the interval clock.

### A5. Surprise follow-up UX: interrupt vs enqueue — **Soon**

When `bayesian_surprise > diagnostic_threshold` with negative direction, does the diagnostic follow-up interrupt the current queue, or get inserted as the next item after feedback?

*Recommendation:* Insert as the next item, never interrupt. Show in the feedback screen "Surprise: high — added diagnostic follow-up to the next position" with a [Skip diagnostic] button. Interruption breaks the learner's flow and feels punitive when a surprise is from a borderline call.

### A6. Mode→axis mapping for domain-registered modes — **Blocking** (per-domain)

Where does the default axis mapping for `language:conversation_turn` or `esports_overwatch:vod_review` live? Currently §16 has a hardcoded table for core modes only.

*Recommendation:* The domain module's `practice_modes()` spec carries default `target_mastery_axes` and `evidence_facets` per mode. Practice Items in that domain can still override. The core router falls back to the mode's domain default; only fails if neither core map nor domain map provides one. Document `PracticeModeSpec` schema in §4.

### A7. Replay trigger: automatic or manual — **Soon**

After an algorithm version bump, is replay automatic on next vault open, or a prompted/manual operation?

*Recommendation:* Prompted with default-accept. On vault open, if `code_algorithm_version != vault_algorithm_version`, show a non-blocking banner: "Algorithm updated (v3 → v4). Replay learner state now? (Recommended) [Replay] [Later] [What changed?]". Never silent: replay can shift mastery numbers and the learner needs to see it. "Later" works for one session; nags every open until done.

### A8. Cold-start surrogate parameters — **Soon**

The heuristic surrogate (A1) needs initial parameters. Where do they come from before the learner has data?

*Recommendation:* Ship `algorithm_priors.yaml` with sane defaults derived from the sample vault's seeded attempts. Per-domain priors override the global priors. After 200 attempts on a domain, the surrogate transitions to learner-specific estimates with shrinkage toward priors (Beta posterior, `prior_pseudo_count = 20`).

---

## B. Grading

### B1. Tier-3 (embedding-similarity) fallback rules — **Soon**

When tier-3 returns below `similarity_threshold`, what happens? Tier-4 LLM grading, manual review, or score-as-incorrect?

*Recommendation:* Below `0.55` → score as incorrect (no escalation; the answer is clearly off-topic). Between `0.55` and `0.85` → escalate to tier-4 LLM. Above `0.85` → accept as correct. Make the two thresholds configurable in `[grading]`. Reasoning: cheap items shouldn't burn an LLM call on a clear miss, but ambiguous-middle cases deserve the better grader.

### B2. Local grader confidence and mastery — **Blocking**

When a grade comes from tier 1–3 (deterministic), what `grader_confidence` does it carry? Tier 4 gets a model-reported number, but local graders are deterministic.

*Recommendation:* Tier 1 (exact-match): 1.0. Tier 2 (rubric-template): 0.95 if all required terms matched, 0.80 if partial. Tier 3 (embedding-similarity above the accept threshold): 0.75 (lower because semantic similarity ≠ correctness). Below `grader_confidence_floor` still triggers manual review per existing policy, so tier 3 mid-range will sometimes prompt the learner — which is appropriate.

### B3. Manual review pile-up UX — **Soon**

A bad day with a weak grader leaves 20+ items pending review. How is the queue presented?

*Recommendation:* TUI shows pending reviews count on the main screen. `learnloop review-grades` opens a fast triage view: keyboard-driven, one item per screen, three keys (✓ accept grade as-is, ✗ override grade, → defer). Batch action: "trust this rubric for the rest of the session" sets a session-scoped flag that auto-accepts tier-4 grades from that rubric template for the next hour.

### B4. Per-mode default hint ladders — **Soon**

Items without explicit `hints` fall back to "per-mode default ladder shipped in `prompts/hint_ladder_<mode>.md`." Are these hand-authored prompts that Codex fills in at runtime, or static text?

*Recommendation:* Static templates with substitutions (`{concept_title}`, `{expected_first_step}`). For modes where no useful generic hint exists (e.g. `recognition`, `multiple_choice`), ship the file with `hints: []` semantics — meaning [Hint] disabled. For free-text modes where a generic ladder is useful (`explain_from_memory`, `derivation_reconstruction`), ship 2-3 generic steps and let Codex generate item-specific hints lazily on first reveal (cached on the Practice Item).

---

## C. Content model & concepts

### C1. What is a "subject" exactly — **Blocking**

Currently subjects are top-level folders. But concepts are global. Can a single note live in two subjects? A research-paper LO might want to surface in both `research-papers` and `survival-analysis`.

*Recommendation:* Subjects are **scopes for views, not for content ownership**. A subject is a saved filter: "show me LOs and notes whose concepts are in my `linear-algebra` view." Notes physically live in one folder but can be tagged with multiple subjects in YAML frontmatter; LOs declare `subjects: [linear-algebra, ml]`. The TUI's subject picker filters by membership, not folder location. Backwards-compat: a note under `subjects/linear-algebra/notes/` is implicitly tagged with that subject.

### C2. Vocabulary scale (language domain) — **Defer**

For language, do we want one Learning Object per vocab word? 5000 LOs adds index/embedding cost.

*Recommendation:* Compact bulk format: `vocab.yaml` with one entry per word, each entry has a synthetic stable LO id (`lo_korean_vocab_<hash>`) that the scheduler treats as a real LO. No full LO YAML file is written for vocab; the bulk file *is* the LO storage. Lazy-promote a vocab entry to a full LO file only when the learner wants to add notes/rubrics specific to that word.

### C3. Worked examples as content vs LO — **Soon**

A worked example file is content; the pattern it teaches is a `worked_example_pattern` LO. Two-way links needed.

*Recommendation:* Worked example Markdown has frontmatter `teaches_lo: <lo_id>`. The LO YAML has `references_worked_examples: [path1, path2]`. `learnloop doctor` verifies bidirectional consistency. When a `worked_example` mode is selected, the scheduler resolves `references_worked_examples` and picks the least-recently-seen example.

### C4. Media references survive file moves — **Soon**

`media-index.yaml` stores paths. User moves files, references break.

*Recommendation:* Each entry has `path` *and* `content_hash` (computed once on import). On read, if the path is missing, scan `[media].search_roots` for files with matching hash. Found → update path, log a fix. Not found → mark as missing in `learnloop doctor`. No silent breakage, no manual re-linking required for renames.

### C5. Observation-to-attempt mapping — **Soon**

Which observation templates auto-emit a formal attempt, and which only update narrative logs until reviewed?

*Recommendation:* Each `ObservationTemplate` declares `emits_attempt: bool`. When true, the template's `emits.evidence_facets` directly produce a `practice_attempts` row with `practice_mode = <domain>:<observation_id>` and grading evidence drawn from the structured response. When false (e.g. a free reflection log), only an `observation_events` row is written, and a separate "review observations" sweep at session end offers to promote it to an attempt with rubric prompting.

---

## D. Replayability & versioning

### D1. Algorithm semantic versioning rules — **Soon**

Version numbers need rules. MAJOR.MINOR.PATCH applied to what? "Algorithm" includes mastery, surprise, scheduler scoring, surrogate, grader tiers, and faded sequence logic.

*Recommendation:* One number for the whole derived-state pipeline (`algorithm_version` is one semver string). MAJOR = output of replay would change non-trivially (mastery numbers move). MINOR = new fields/tables added, old fields preserved. PATCH = bugfix that produces identical outputs except for previously-buggy cases. Replay is required on MAJOR, prompted on MINOR, silent on PATCH.

### D2. Replay determinism across machines — **Defer**

If a vault is moved to another machine, replay must produce identical mastery numbers (same algorithm version, same raw events). Embeddings, however, depend on the local model. Does replay re-embed?

*Recommendation:* Replay does **not** re-embed. Embeddings are an index, not derived learner state. If the embedding model changes, run `learnloop reindex-embeddings` separately. Scheduler outputs that depend on embeddings (concept-merge suggestions, near-duplicate detection) are not part of replay's invariants.

### D3. Domain migration policy when a plugin is removed — **Soon**

A domain module may have added namespaced SQLite tables. If the user removes the plugin, what happens?

*Recommendation:* Domain tables are preserved (data is not deleted on plugin removal), but the domain's scheduler hooks, TUI panels, and grading rubrics become dormant. The core falls back to generic handling. `learnloop doctor` warns about orphaned domain tables but does not delete. Re-adding the plugin reactivates everything.

---

## E. UX

### E1. Answer input widget — **Soon**

The TUI needs short inline answers, $EDITOR long answers, LaTeX-friendly math, code blocks. What's MVP?

*Recommendation:* MVP: inline single-line for short answers (≤120 chars), Ctrl-E to open $EDITOR for multi-line. Markdown with LaTeX-style `$...$` and `$$...$$` rendered in feedback view (Rich math display where possible, raw fallback otherwise). Code answers are just fenced Markdown code blocks — no in-TUI syntax highlighting in MVP. Defer: dedicated math input widget, sandboxed code execution.

### E2. Uncertainty dashboard — **Defer**

MVP exposes `learnloop uncertainty` and "Why now?". Richer chart view of belief variance over time is later.

*Recommendation:* MVP: `learnloop uncertainty` returns a ranked text table of "top 10 highest-variance beliefs scoped to active goals" with `mean`, `variance`, `last_evidence_at`, `staleness_days`. That's enough to be useful. Defer interactive dashboards.

### E3. Domain-specific TUI panel contract — **Defer**

How do domain modules contribute TUI panels without making Textual framework code domain-aware?

*Recommendation:* Each domain exposes `tui_panels() → list[TuiPanelSpec]` where each spec is `{slot, widget_factory, predicate}`. Slots are predefined: `practice_screen_sidebar`, `feedback_screen_extras`, `subject_dashboard_extras`. The TUI shell renders any panel whose `predicate(context)` returns true. Concretely: Overwatch can add a VOD-timestamp panel to the practice screen sidebar when `subject.domain == esports_overwatch`. Defer detailed UI work until after MVP scheduler is solid.

### E4. Git policy default — **Resolved-ish, confirm**

Vaults are git-friendly. `[storage].autocommit = false` is the default. Anything else needed?

*Recommendation:* Add a shipped `.gitignore` template with `state.sqlite`, `.learnloop/`, `exports/` excluded by default (these are derived/mutable; the user can opt them in). Add `learnloop git-init` convenience that runs `git init` and writes the `.gitignore`. No automatic commits; no automatic branch creation.

---

## F. Codex integration

### F1. Codex availability detection — **Blocking**

When is "Codex is unavailable" detected — vault open, first AI feature, or per-call?

*Recommendation:* Lazy with caching. First AI feature call probes the SDK; result cached for `[ai].availability_cache_seconds` (default 300). On rate-limit or auth error during a call, mark unavailable for `rate_limit_backoff_seconds` and surface a TUI toast. The session continues in degraded mode automatically.

### F2. Rate-limit handling during a session — **Soon**

Subscription tiers have per-hour rate limits. What happens mid-session when we hit one?

*Recommendation:* Per `[ai].rate_limit_strategy`: `queue_then_self_grade` (default) queues retries with exponential backoff for up to 90s; if still failing, the current item routes to self-grade with a clear notification. Tutor turns drop to a static "Codex unavailable — try again in a few minutes" message. Generation paths defer the item back to next session. Never block the session waiting for Codex.

### F3. Codex-simulator ephemeral proposer prompt structure — **Soon**

The Layer-4 simulator path says the proposer prompt receives "the LO and its current belief means/variances, the recent attempt history for that LO, and a short list of plausible learner states to discriminate." What's the *concrete* structure of "plausible learner states to discriminate"?

*Recommendation:* The proposer is given 2–4 named hypotheses of the form `{id, description, predicted_axis_profile}`. For example: `{id: "memorized_no_schema", description: "Can recall the definition but can't apply it", predicted_axis_profile: {memory: 0.85, understanding: 0.35}}`. The hypotheses are generated locally from the heuristic surrogate's top modes of the posterior, *not* by Codex. Codex is only the question proposer, not the hypothesis generator. This keeps the simulator path cheap and deterministic in everything except the final question text.

### F4. Conversation thread management — **Soon**

The adapter says "create or resume a Codex thread for a subject/purpose." How granular? One thread per session? Per LO? Per attempt?

*Recommendation:* One thread per (subject, purpose). Tutor and grader purposes are separate threads. Resume across sessions for tutor purpose only; grader/diagnoser/generator/ingestor are stateless per-call. Cap thread length: when a tutor thread exceeds N turns or M tokens, archive it and start a new one with a summary continuation.

---

## G. Privacy

### G1. What leaves the machine — **Resolved, confirm**

Default policy: no product telemetry. Local content leaves the machine only through explicit Codex calls.

*Recommendation:* Document this in `README.md` and `learnloop.toml` as `[privacy] outbound_only_to = ["codex_subscription"]`. `learnloop doctor` includes a privacy section showing every outbound destination it knows about, and refuses to add new ones without a config flip.

### G2. Codex content filtering — **Soon**

A learner's vault may contain medical notes, personal info, draft research. When LearnLoop sends context to Codex, what's the redaction model?

*Recommendation:* Per-vault `[privacy].codex_send_allowlist` and `codex_send_denylist` of glob patterns. By default, `profile/*.md` and `subjects/*/notes/*.md` are allowed (they're the point); `errors/global-error-log.md` and `sessions/*.md` are allowed (needed for tutor continuity). The denylist is empty by default but the toml template ships with commented examples like `# constraints.md  # if you put PII here`. Show the redaction summary in the TUI before any tutor turn that includes new files.

---

## H. Numbers that need tuning

These need a default and a way to revisit, not a blocking decision now:

- **EMA `alpha`** (currently 0.2). Sensitive to attempt frequency. Defer tuning to post-MVP with the sample vault as a calibration target.
- **`surprise_diagnostic_threshold`** (1.5). Tied to the bayesian_surprise scale; needs to be set jointly with the surrogate's parameters in A1.
- **`information_gain_weight`** (0.15) and **`error_uncertainty_weight`** (0.10) in the priority formula. Same as above — joint calibration.
- **Embedding similarity thresholds** (0.85 merge, 0.92 dedup). Validated against a small labeled set during the embedding implementation slice.

---

## Implementation order implied by these answers

If we accept the recommended answers above, the blocking questions cluster around scheduler/grading internals. Implementation order:

1. C1 (subject as view), C2 (vocabulary lazy promotion) — affects storage layout.
2. A1 (surrogate functional form), A2 (cross-LO updates), A3 (axis correlation), A6 (domain mode→axis), A8 (cold-start priors) — scheduler core.
3. B2 (local grader confidence) — grader core.
4. F1 (Codex availability detection) — adapter core.
5. Everything else is Soon/Defer; can be answered slice by slice.

---

## How to use this document

Walk through one section at a time. For each question, the user either accepts the recommendation, picks a different answer (which I'll record here), or marks it deferred. Resolved questions get folded into the spec as concrete decisions; this file shrinks over time and ends up archived once empty.
