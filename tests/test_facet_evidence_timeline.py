"""Facet evidence timeline — the Demonstrated curve (KM §9.6 phase 1, §16).

Two layers: the pure fold's determinism/correction invariants (no DB), and the
end-to-end extraction over a real mvp-0.7 vault including a regrade that retires
an observation and renders as a visible correction step.
"""

from __future__ import annotations

from learnloop.clock import FrozenClock
from learnloop.services.facet_evidence_timeline import (
    ObservationEvent,
    facet_evidence_timeline,
    fold_demonstrated_timeline,
)

from tests.helpers import NOW
from tests.test_km3_projections import COMP_A, INTEG, blueprint_vault  # noqa: F401


def _obs(attempt_id, at, *, kind="observation", group="g", assisted=False, caps=None):
    return ObservationEvent(
        attempt_id=attempt_id,
        event_at=at,
        kind=kind,
        surface_group=group,
        assisted=assisted,
        per_capability_positive=caps or {"procedure_execution": 1.0},
    )


# -- Pure fold invariants (§16) ------------------------------------------------


def test_fresh_unassisted_observations_rise_monotonically():
    events = [
        _obs("a1", "2026-01-01T00:00:00Z", group="g1"),
        _obs("a2", "2026-01-02T00:00:00Z", group="g2"),
    ]
    series = fold_demonstrated_timeline(events)
    assert len(series) == 2
    assert series[0].demonstrated > 0.0
    assert series[1].demonstrated > series[0].demonstrated
    assert all(p.delta >= 0 for p in series)
    assert not any(p.is_correction for p in series)


def test_assisted_observation_earns_zero_credit():
    series = fold_demonstrated_timeline([_obs("a1", "t1", assisted=True)])
    assert series[0].demonstrated == 0.0
    assert series[0].delta == 0.0


def test_repeat_surface_group_is_discounted():
    fresh = fold_demonstrated_timeline([_obs("a1", "t1", group="g1")])[0].demonstrated
    repeat = fold_demonstrated_timeline(
        [_obs("a1", "t1", group="g1"), _obs("a2", "t2", group="g1")]
    )
    # The second observation on the same surface adds less than a fresh one.
    assert repeat[1].delta < fresh


def test_regrade_correction_steps_the_curve_down():
    """§16: a regrade that lowers credit renders as a visible downward step,
    never a silent restatement."""

    events = [
        _obs("a1", "2026-01-01T00:00:00Z", kind="observation", group="g1", caps={"procedure_execution": 1.0}),
        # A later regrade epoch of the SAME attempt with weaker evidence.
        _obs("a1", "2026-01-05T00:00:00Z", kind="correction", group="g1", caps={"procedure_execution": 0.2}),
    ]
    series = fold_demonstrated_timeline(events)
    assert len(series) == 2
    assert series[1].is_correction is True
    assert series[1].delta < 0.0
    assert series[1].demonstrated < series[0].demonstrated


def test_correction_that_retires_all_credit_steps_to_zero():
    events = [
        _obs("a1", "t1", kind="observation", caps={"procedure_execution": 1.0}),
        _obs("a1", "t2", kind="correction", assisted=True, caps={"procedure_execution": 1.0}),
    ]
    series = fold_demonstrated_timeline(events)
    assert series[1].demonstrated == 0.0
    assert series[1].is_correction is True


def test_recompute_from_scratch_equals_incremental_render():
    """§16 core invariant: the deterministic fold over prefixes is byte-identical
    to the full fold (a pure left fold)."""

    events = [
        _obs("a1", "t1", group="g1", caps={"c1": 1.0}),
        _obs("a2", "t2", group="g2", caps={"c1": 0.5, "c2": 0.5}),
        _obs("a1", "t3", kind="correction", group="g1", caps={"c1": 0.1}),
        _obs("a3", "t4", group="g2", caps={"c2": 0.9}),
    ]
    full = fold_demonstrated_timeline(events)
    for i in range(1, len(events) + 1):
        prefix = fold_demonstrated_timeline(events[:i])
        # Recomputing the prefix from scratch reproduces the first i points exactly.
        assert [p.as_dict() for p in prefix] == [p.as_dict() for p in full[:i]]


# -- End-to-end extraction over a real vault (with a regrade) ------------------


def _attempt(vault, repository, item_id, criterion, *, hints_used=0, clock=None):
    from learnloop.services.attempts import (
        AttemptDraft,
        SelfGradeInput,
        complete_self_graded_attempt,
    )

    return complete_self_graded_attempt(
        vault,
        repository,
        AttemptDraft(
            practice_item_id=item_id,
            learner_answer_md="An answer.",
            attempt_type="independent_attempt",
            hints_used=hints_used,
        ),
        SelfGradeInput(criterion_points={"c1": criterion}, fatal_errors=[], confidence=4),
        clock=clock or FrozenClock(NOW),
    )


def test_timeline_rises_on_real_unassisted_demonstration(blueprint_vault):
    vault, repository = blueprint_vault
    _attempt(vault, repository, "pi_comp_a", 4)

    series = facet_evidence_timeline(vault, repository, COMP_A)
    assert series, "expected at least one observation point for the demonstrated facet"
    assert series[-1].demonstrated > 0.0
    assert not series[-1].is_correction


def test_hinted_attempt_contributes_flat_point(blueprint_vault):
    vault, repository = blueprint_vault
    _attempt(vault, repository, "pi_comp_a", 4, hints_used=1)
    series = facet_evidence_timeline(vault, repository, COMP_A)
    # Assisted evidence earns no certification credit (§5.4): the curve stays at 0.
    assert series
    assert series[-1].demonstrated == 0.0


def test_real_regrade_renders_as_correction_step(blueprint_vault):
    """Drive a genuine grading supersession and confirm the extraction surfaces a
    correction epoch (§16)."""

    vault, repository = blueprint_vault
    result = _attempt(vault, repository, "pi_comp_a", 4)
    attempt_id = result.attempt_id if hasattr(result, "attempt_id") else result["attempt_id"]

    before = facet_evidence_timeline(vault, repository, COMP_A)
    assert before and before[-1].demonstrated > 0.0

    # Regrade: supersede the original self-grade rows and insert a weaker epoch
    # at a later time (a real retire-and-restate on the immutable ledger).
    repository.supersede_self_grade_rows(
        attempt_id, superseded_by_evidence_id="regrade_evt_1"
    )
    repository.insert_grading_evidence(
        attempt_id,
        [
            {
                "id": "regrade_evt_1",
                "criterion_id": "c1",
                "points_awarded": 1.0,
                "evidence": None,
                "notes": "regrade",
                "grader_tier": 1,
                "created_at": "2026-12-31T00:00:00Z",
            }
        ],
    )

    after = facet_evidence_timeline(vault, repository, COMP_A)
    corrections = [p for p in after if p.is_correction]
    assert corrections, "a regrade must render as a visible correction event"
    assert after[-1].demonstrated < before[-1].demonstrated
