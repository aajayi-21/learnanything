AUTHORING_PROMPT_VERSION = "mvp-0.2-authoring-difficulty"
CANONICAL_INGEST_PROMPT_VERSION = "mvp-0.2-canonical-ingest-difficulty"
GRADING_PROMPT_VERSION = "mvp-0.5-misconception-statements"
TUTOR_QA_PROMPT_VERSION = "mvp-0.4-tutor-qa"
TEACH_BACK_PROMPT_VERSION = "mvp-0.4-teach-back"
MISCONCEPTION_MATCH_PROMPT_VERSION = "mvp-0.5-misconception-match"
DIAGNOSTIC_AUTHORING_PROMPT_VERSION = "mvp-0.5-diagnostic-authoring"
DIAGNOSTIC_TRIALS_PROMPT_VERSION = "mvp-0.5-diagnostic-trials"

# spec_misconception_diagnostics.md §5.2 — the five constraints a generated
# diagnostic must satisfy, stated domain-generally (computation is only the
# math-vault instantiation). Embedded verbatim-ish into the authoring
# ``instructions`` so the versioned prompt carries them.
DIAGNOSTIC_AUTHORING_PROMPT = """\
Author ONE diagnostic Practice Item that discriminates the target misconception \
below. The item must satisfy ALL of these constraints (spec §5.2):

1. Forced application to a concrete instance: the learner must APPLY their model \
to a specific case and commit to an output (compute a value or choose between \
operators; commit to a holding on a novel fact pattern; predict a mechanism's \
behaviour under a stated change) — not restate or re-derive the rule.
2. Documented categorical contrast: provide BOTH `expected_answer` and \
`misconception_consistent_answer`; they must differ CATEGORICALLY (different \
value, holding, choice, or predicted behaviour), never merely in emphasis or \
completeness.
3. Misconception-keyed fatal error: the grading rubric must carry at least one \
fatal error with `misconception_id` set to the target misconception id, \
describing its signature.
4. Surface shift: `surface_family` MUST differ from the source item's \
surface_family.
5. Minimal footprint: `evidence_facets` must be a subset of the implicated \
facets; do NOT re-test criteria the learner already demonstrated.
"""

