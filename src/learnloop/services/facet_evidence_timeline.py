"""Facet evidence timeline — the Demonstrated curve (KM §9.6 phase 1, §16).

A deterministic, replayable fold over the immutable observation ledger,
*including* grading supersessions, retired observations and corrected
attribution, producing a **non-monotone** Demonstrated curve for one canonical
facet. A regrade that retires/replaces an observation renders as a visible
annotated correction event — the curve may step down — rather than being
smoothed away.

The fold is a pure function (:func:`fold_demonstrated_timeline`): recomputing the
series from scratch is byte-identical to rendering it incrementally (§16), which
its unit test asserts directly. No snapshot tables, no replay — the sidecar
extracts observation events from the persisted rows and folds them.

Design notes (deliberate phase-1 simplifications, documented):

* The plotted quantity is cumulative **certification credit** for the facet: the
  direct, unassisted, capability-matched positive pseudo-mass accrued so far —
  the same primitive the KM2 canonical projection banks (``certification_credit``
  over ``allocate_success_mass``). Assisted attempts earn zero credit (§5.4), so
  a hinted attempt is a flat point, not a rise.
* Independence is tracked by first-appearance of each surface/correlation group
  in event order; a repeat surface is discounted (``repeat_surface_discount``),
  matching the projection's per-group novelty rule. The per-group certification
  *cap* and the attempt-wide ceiling the batch projection applies are not
  reproduced point-by-point — an honest phase-1 approximation of magnitude that
  preserves the exact shape (rises on fresh direct evidence, steps on
  correction). The final value is therefore an upper-ish bound on the banked
  ledger credit, never a different sign of movement.
* Each graded attempt contributes exactly its *latest grading epoch*'s credit.
  A regrade replaces the attempt's previous contribution (not adds to it), so the
  running total is always ``Σ latest-epoch-credit`` — the "as-of" invariant that
  makes from-scratch == incremental.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from learnloop.db.repositories import Repository
from learnloop.services.capability_mapping import (
    CriterionOutcome,
    allocate_success_mass,
    certification_credit,
    compile_criterion_targets,
    criterion_pseudo_mass,
    localize_criterion_outcomes,
)
from learnloop.services.canonical_projection import (
    ASSISTED_ATTEMPT_TYPES,
    DEFAULT_REPEAT_SURFACE_DISCOUNT,
    FAILURE_THRESHOLD,
    _repeat_discount,
    surface_group_id,
)
from learnloop.services.evidence import attempt_evidence_mass
from learnloop.vault.models import LoadedVault


@dataclass(frozen=True)
class ObservationEvent:
    """One grading epoch of one attempt, as it bears on a single facet.

    Pure/DB-free so the fold can be unit-tested without a repository. ``kind`` is
    ``observation`` for an attempt's first grading and ``correction`` for every
    later regrade epoch (which supersedes the previous one).
    """

    attempt_id: str
    event_at: str
    kind: str  # "observation" | "correction"
    surface_group: str
    assisted: bool
    # positive pseudo-mass allocated to the facet in this epoch, per capability
    per_capability_positive: dict[str, float] = field(default_factory=dict)

    @property
    def raw_positive(self) -> float:
        return sum(self.per_capability_positive.values())


@dataclass(frozen=True)
class TimelinePoint:
    t: str
    demonstrated: float          # cumulative certification credit (non-monotone)
    delta: float                 # signed change at this event
    kind: str                    # "observation" | "correction"
    is_correction: bool
    attempt_id: str
    surface_group: str
    assisted: bool
    # capabilities with cumulative positive credit after this event
    demonstrated_capabilities: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "t": self.t,
            "demonstrated": self.demonstrated,
            "delta": self.delta,
            "kind": self.kind,
            "is_correction": self.is_correction,
            "attempt_id": self.attempt_id,
            "surface_group": self.surface_group,
            "assisted": self.assisted,
            "demonstrated_capabilities": list(self.demonstrated_capabilities),
        }


def fold_demonstrated_timeline(
    events: list[ObservationEvent],
    *,
    repeat_surface_discount: float = DEFAULT_REPEAT_SURFACE_DISCOUNT,
) -> list[TimelinePoint]:
    """Fold ordered observation events into the Demonstrated curve (pure).

    Events MUST already be in stable chronological order. The result is a
    deterministic function of the input alone — folding prefixes incrementally
    yields the identical series (the §16 replay invariant).
    """

    seen_groups: set[str] = set()
    contribution_by_attempt: dict[str, float] = {}
    per_capability_total: dict[str, float] = {}
    # per-attempt latest epoch's per-capability contribution, so a correction
    # replaces (not stacks on) the attempt's previous capability credit.
    attempt_capability: dict[str, dict[str, float]] = {}
    cumulative = 0.0
    series: list[TimelinePoint] = []

    for event in events:
        is_new_group = event.surface_group not in seen_groups
        discount = 1.0 if is_new_group else repeat_surface_discount
        seen_groups.add(event.surface_group)

        new_caps: dict[str, float] = {}
        if not event.assisted:
            for capability, positive in event.per_capability_positive.items():
                credit = certification_credit(
                    positive * discount, relationship="direct", assistance="unassisted"
                )
                if credit > 0.0:
                    new_caps[capability] = credit
        new_contrib = sum(new_caps.values())

        old_contrib = contribution_by_attempt.get(event.attempt_id, 0.0)
        old_caps = attempt_capability.get(event.attempt_id, {})
        # Replace this attempt's capability credit with the latest epoch's.
        for capability, value in old_caps.items():
            per_capability_total[capability] = per_capability_total.get(capability, 0.0) - value
        for capability, value in new_caps.items():
            per_capability_total[capability] = per_capability_total.get(capability, 0.0) + value
        attempt_capability[event.attempt_id] = new_caps
        contribution_by_attempt[event.attempt_id] = new_contrib

        delta = new_contrib - old_contrib
        cumulative += delta
        demonstrated_caps = tuple(
            sorted(cap for cap, value in per_capability_total.items() if value > 1e-9)
        )
        series.append(
            TimelinePoint(
                t=event.event_at,
                demonstrated=cumulative,
                delta=delta,
                kind=event.kind,
                is_correction=event.kind == "correction",
                attempt_id=event.attempt_id,
                surface_group=event.surface_group,
                assisted=event.assisted,
                demonstrated_capabilities=demonstrated_caps,
            )
        )
    return series


def _epoch_positive_mass(
    vault: LoadedVault,
    item,
    rubric,
    canonical_facet: str,
    *,
    rows_by_criterion: dict[str, dict],
    attempt_type: str,
) -> dict[str, float]:
    """Positive pseudo-mass allocated to ``canonical_facet`` in one grading epoch.

    Mirrors the KM2 canonical projection's per-attempt accumulation: localize the
    criterion DAG, drop unassessable descendants of a first error (share 0, §5.3),
    then allocate each assessable criterion's success pseudo-mass across its
    targets and keep the share landing on this facet's capabilities.
    """

    rubric_total = sum(max(c.points, 0.0) for c in rubric.criteria) or 1.0
    emass = attempt_evidence_mass(attempt_type, vault.config.evidence)
    outcomes: list[CriterionOutcome] = []
    for criterion in rubric.criteria:
        row = rows_by_criterion.get(criterion.id)
        fraction = 0.0
        if row is not None and criterion.points > 0:
            fraction = max(0.0, min(1.0, float(row["points_awarded"]) / criterion.points))
        outcomes.append(
            CriterionOutcome(
                criterion_id=criterion.id,
                passed=fraction >= FAILURE_THRESHOLD,
                depends_on=tuple(criterion.depends_on),
            )
        )
    localized = {c.criterion_id: c for c in localize_criterion_outcomes(outcomes)}
    criteria_by_id = {c.id: c for c in rubric.criteria}

    per_capability: dict[str, float] = {}
    for outcome in outcomes:
        local = localized[outcome.criterion_id]
        if not local.assessable:
            continue
        criterion = criteria_by_id[outcome.criterion_id]
        row = rows_by_criterion.get(criterion.id)
        fraction = 0.0
        if row is not None and criterion.points > 0:
            fraction = max(0.0, min(1.0, float(row["points_awarded"]) / criterion.points))
        targets = compile_criterion_targets(item, criterion, resolved_rubric=rubric)
        if not targets:
            continue
        pmass = criterion_pseudo_mass(criterion.points, rubric_total, emass)
        for alloc in allocate_success_mass(targets, pmass):
            if vault.canonical_facet_id(alloc.facet) != canonical_facet:
                continue
            per_capability[alloc.capability] = (
                per_capability.get(alloc.capability, 0.0) + alloc.pseudo_mass * fraction
            )
    return per_capability


def _observation_events(
    vault: LoadedVault, repository: Repository, canonical_facet: str
) -> list[ObservationEvent]:
    """Extract ordered observation events for a facet from persisted rows.

    Reads the full grading history (``include_superseded=True``) so regrades
    surface as later epochs; attempts are ordered chronologically and epochs
    within an attempt by grading time.
    """

    events: list[ObservationEvent] = []
    for attempt in repository.list_attempt_history():
        item = vault.practice_items.get(attempt["practice_item_id"])
        if item is None:
            continue
        # Does this attempt's item touch the facet at all? (cheap pre-filter)
        item_facets = {vault.canonical_facet_id(str(f)) for f in item.evidence_facets}
        if canonical_facet not in item_facets:
            continue
        rubric = vault.rubric_for_item(item)
        if rubric is None or not rubric.criteria:
            continue
        rows = repository.fetch_grading_evidence(attempt["id"], include_superseded=True)
        if not rows:
            continue
        # Group evidence rows into grading epochs by their created_at (a regrade
        # supersedes the whole prior set and inserts a fresh one).
        epochs: dict[str, dict[str, dict]] = {}
        epoch_order: list[str] = []
        for record in rows:
            key = record.created_at
            if key not in epochs:
                epochs[key] = {}
                epoch_order.append(key)
            epochs[key][record.criterion_id] = {
                "points_awarded": record.points_awarded,
            }
        epoch_order.sort()
        assisted = (
            attempt["attempt_type"] in ASSISTED_ATTEMPT_TYPES
            or int(attempt.get("hints_used") or 0) > 0
        )
        group = surface_group_id(item)
        for index, epoch_at in enumerate(epoch_order):
            per_capability = _epoch_positive_mass(
                vault,
                item,
                rubric,
                canonical_facet,
                rows_by_criterion=epochs[epoch_at],
                attempt_type=attempt["attempt_type"],
            )
            events.append(
                ObservationEvent(
                    attempt_id=attempt["id"],
                    event_at=epoch_at,
                    kind="observation" if index == 0 else "correction",
                    surface_group=group,
                    assisted=assisted,
                    per_capability_positive=per_capability,
                )
            )
    # Stable global order: by event time, then attempt id, then original order.
    events.sort(key=lambda event: (event.event_at, event.attempt_id))
    return events


def facet_evidence_timeline(
    vault: LoadedVault, repository: Repository, facet_id: str
) -> list[TimelinePoint]:
    """The Demonstrated curve for ``facet_id`` (canonicalized) — the §9.6 phase-1
    surface. Empty list when the facet has no graded evidence."""

    canonical = vault.canonical_facet_id(facet_id)
    events = _observation_events(vault, repository, canonical)
    return fold_demonstrated_timeline(
        events, repeat_surface_discount=_repeat_discount(vault)
    )
