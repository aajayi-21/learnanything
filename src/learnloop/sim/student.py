"""Synthetic student: parameterized ground-truth learner model.

The student is the *data-generating process* the belief pipeline is asked to
recover. Ground truth lives per evidence facet:

- ``true_mastery`` in [0, 1]: probability of demonstrating the facet on an
  unassisted attempt, before slip/guess noise.
- ``learning_rate``: each graded practice of a facet moves mastery toward 1 by
  ``learning_rate * weight * (1 - mastery)`` (diminishing returns).
- ``forgetting_halflife_days``: between practices, mastery above the
  ``forgetting_floor`` decays exponentially with this halflife
  (``m(t) = floor + (m - floor) * 2**(-elapsed/halflife)``). The floor models
  relearning savings: forgotten material does not return to zero.

Outcome generation for one practice item:

1. Per-criterion P(demonstrate) is the criterion's facet-weighted mean of
   current facet masteries (weights from ``criterion_facet_weights_for_item``,
   the same mapping the belief pipeline uses).
2. **Misconceptions** are the identifiability signal. Each planted
   misconception ``{facet_id, error_type, strength}`` fires with probability
   ``strength`` whenever an item meaningfully tests that facet. When it fires,
   the student errs *systematically and confidently*: criteria weighted to the
   facet get zero points, the outcome carries an error attribution with that
   ``error_type`` (``is_misconception=True``), and self-reported confidence is
   high regardless of calibration. Each corrective exposure (feedback after the
   misconception fires) decays ``strength`` by ``misconception_remediation_rate``.
3. Otherwise per-criterion success is Bernoulli with
   ``p = guess + (1 - slip - guess) * p_know``; a failed criterion still earns
   half credit with a small probability (partial work).
4. If overall item knowledge is below ``dont_know_threshold`` the student may
   declare "don't know" (probability ``dont_know_propensity``) instead of
   guessing -- exercising the deterministic recall_failure path.
5. Hints: one hint is requested with probability
   ``hint_propensity * (1 - p_know)`` when the item offers hints.
6. Latency is drawn from a seeded exponential around a base that grows as
   knowledge drops.
7. Confidence (1-5 self grade) tracks realized P(correct) through
   ``confidence_calibration``: perfect calibration reports the true quintile;
   lower calibration mixes in seeded noise; ``confidence_bias`` shifts the
   whole scale (overconfident students report high confidence on wrong
   answers).

All randomness comes from one ``random.Random(seed)`` instance owned by the
student -- no global seeding -- so a (profile, seed) pair replays bit-for-bit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence


@dataclass
class Misconception:
    """A planted, systematic, confident error tied to one evidence facet."""

    facet_id: str
    error_type: str
    strength: float = 0.85
    severity: float = 0.7
    # spec §6: optional link to a content-bearing registry belief so the sim
    # discrimination gate can plant *this* misconception and answer an item with
    # its consistent answer. Absent on legacy facet-only planted misconceptions.
    misconception_id: str | None = None
    statement: str | None = None
    misconception_consistent_answer: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "facet_id": self.facet_id,
            "error_type": self.error_type,
            "strength": self.strength,
            "severity": self.severity,
            "misconception_id": self.misconception_id,
            "statement": self.statement,
            "misconception_consistent_answer": self.misconception_consistent_answer,
        }


@dataclass
class FacetParams:
    """Per-facet ground-truth overrides; unset fields inherit profile defaults."""

    true_mastery: float | None = None
    learning_rate: float | None = None
    forgetting_halflife_days: float | None = None


@dataclass
class StudentProfile:
    name: str = "custom"
    true_mastery: float = 0.4
    learning_rate: float = 0.15
    forgetting_halflife_days: float = 30.0
    forgetting_floor: float = 0.15
    slip: float = 0.05
    guess: float = 0.08
    hint_propensity: float = 0.25
    confidence_calibration: float = 0.8
    confidence_bias: float = 0.0
    dont_know_threshold: float = 0.15
    dont_know_propensity: float = 0.5
    misconception_remediation_rate: float = 0.08
    # Teach-back: transfer-tier follow-ups stress-test knowledge beyond the
    # taught surface, so effective P(know) drops by this delta before slip/guess.
    transfer_difficulty_delta: float = 0.2
    # Primed retry (the student just re-read the canonical source section):
    # working memory floors effective P(know) at priming_level for that one
    # attempt, and the re-read decays a tested misconception's strength by
    # source_remediation_rate (0.0 = sticky misconception that survives the
    # source; high = shallow gap the source repairs).
    priming_level: float = 0.85
    source_remediation_rate: float = 0.5
    misconceptions: list[Misconception] = field(default_factory=list)
    facets: dict[str, FacetParams] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "true_mastery": self.true_mastery,
            "learning_rate": self.learning_rate,
            "forgetting_halflife_days": self.forgetting_halflife_days,
            "forgetting_floor": self.forgetting_floor,
            "slip": self.slip,
            "guess": self.guess,
            "hint_propensity": self.hint_propensity,
            "confidence_calibration": self.confidence_calibration,
            "confidence_bias": self.confidence_bias,
            "dont_know_threshold": self.dont_know_threshold,
            "dont_know_propensity": self.dont_know_propensity,
            "misconception_remediation_rate": self.misconception_remediation_rate,
            "transfer_difficulty_delta": self.transfer_difficulty_delta,
            "priming_level": self.priming_level,
            "source_remediation_rate": self.source_remediation_rate,
            "misconceptions": [m.as_dict() for m in self.misconceptions],
            "facets": {
                facet: {
                    "true_mastery": params.true_mastery,
                    "learning_rate": params.learning_rate,
                    "forgetting_halflife_days": params.forgetting_halflife_days,
                }
                for facet, params in self.facets.items()
            },
        }


@dataclass(frozen=True)
class SimAttribution:
    error_type: str
    severity: float
    is_misconception: bool
    target_facets: tuple[str, ...] = ()
    evidence: str | None = None


@dataclass(frozen=True)
class SimOutcome:
    """One generated attempt outcome, ready to be resolved into a grade."""

    dont_know: bool
    criterion_points: dict[str, float]
    hints_used: int
    latency_seconds: int
    confidence: int
    attributions: list[SimAttribution]
    p_correct_truth: float
    misconception_fired: str | None


@dataclass(frozen=True)
class SimTeachBackAnswer:
    """One synthesized learner answer to a teach-back follow-up question."""

    points_awarded: float
    p_know_effective: float
    latency_seconds: int
    answer_md: str


@dataclass
class _FacetState:
    mastery: float
    learning_rate: float
    halflife: float
    last_update_day: float = 0.0


# An item "meaningfully tests" a facet when its normalized weight is at least
# this share -- mirrors the spirit of recall_coverage.tau_facet_share.
_MISCONCEPTION_MIN_WEIGHT = 0.10
_PARTIAL_CREDIT_PROBABILITY = 0.3


class SyntheticStudent:
    def __init__(self, profile: StudentProfile, seed: int):
        import random

        self.profile = profile
        self.rng = random.Random(seed)
        self._facets: dict[str, _FacetState] = {}
        # Mutable copy so remediation can decay strengths without touching the profile.
        self.misconception_strengths: dict[str, float] = {
            m.facet_id: m.strength for m in profile.misconceptions
        }
        self._misconceptions_by_facet: dict[str, Misconception] = {
            m.facet_id: m for m in profile.misconceptions
        }

    # -- ground truth ------------------------------------------------------

    def _state(self, facet_id: str) -> _FacetState:
        state = self._facets.get(facet_id)
        if state is None:
            override = self.profile.facets.get(facet_id) or FacetParams()
            state = _FacetState(
                mastery=override.true_mastery
                if override.true_mastery is not None
                else self.profile.true_mastery,
                learning_rate=override.learning_rate
                if override.learning_rate is not None
                else self.profile.learning_rate,
                halflife=override.forgetting_halflife_days
                if override.forgetting_halflife_days is not None
                else self.profile.forgetting_halflife_days,
            )
            self._facets[facet_id] = state
        return state

    def mastery_at(self, facet_id: str, day: float) -> float:
        """Current true mastery, applying lazy exponential forgetting."""

        state = self._state(facet_id)
        elapsed = max(0.0, day - state.last_update_day)
        if elapsed > 0 and state.halflife > 0:
            floor = min(self.profile.forgetting_floor, state.mastery)
            state.mastery = floor + (state.mastery - floor) * 2.0 ** (-elapsed / state.halflife)
            state.last_update_day = day
        return state.mastery

    def projected_mastery(self, facet_id: str, day: float, extra_days: float) -> float:
        """True mastery ``extra_days`` after ``day`` with no intervening practice.

        Computed analytically from the forgetting model rather than by
        advancing state, so measuring "retention 30 days after the goal due
        date" cannot disturb the lazy-decay bookkeeping. ``day`` must not be
        earlier than the facet's last settle (same contract as mastery_at).
        """

        mastery = self.mastery_at(facet_id, day)
        state = self._state(facet_id)
        if extra_days <= 0 or state.halflife <= 0:
            return mastery
        floor = min(self.profile.forgetting_floor, mastery)
        return floor + (mastery - floor) * 2.0 ** (-extra_days / state.halflife)

    def learn(self, facet_weights: Mapping[str, float], day: float) -> None:
        """Apply practice gains (feedback was shown) after an attempt."""

        for facet_id, weight in facet_weights.items():
            state = self._state(facet_id)
            self.mastery_at(facet_id, day)  # settle forgetting first
            state.mastery += state.learning_rate * float(weight) * (1.0 - state.mastery)
            state.mastery = min(1.0, max(0.0, state.mastery))
            state.last_update_day = day

    def truth_snapshot(self, day: float) -> dict[str, float]:
        return {facet: self.mastery_at(facet, day) for facet in sorted(self._facets)}

    # -- outcome generation --------------------------------------------------

    def attempt(
        self,
        *,
        day: float,
        item_facet_weights: Mapping[str, float],
        criteria: Sequence[tuple[str, float, Mapping[str, float]]],
        hints_available: int,
        primed: bool = False,
    ) -> SimOutcome:
        """Generate one attempt outcome.

        ``criteria`` is ``[(criterion_id, max_points, facet_weights), ...]``
        where facet weights come from the same criterion->facet mapping the
        belief pipeline uses.

        ``primed`` models a retry right after re-reading the source: effective
        P(know) is floored at ``profile.priming_level`` (working memory), and
        tested misconceptions decay by ``profile.source_remediation_rate``
        *before* the firing draw — a sticky misconception (rate 0) keeps firing
        even primed, which is exactly the discriminating signal the facet
        posterior should pick up.
        """

        rng = self.rng
        profile = self.profile
        normalized_item_weights = _normalize(item_facet_weights)
        if primed:
            # Re-reading the source repairs shallow misconceptions on the
            # facets this item tests, independent of the outcome draw below.
            for facet, weight in normalized_item_weights.items():
                if weight < _MISCONCEPTION_MIN_WEIGHT or facet not in self.misconception_strengths:
                    continue
                self.misconception_strengths[facet] = max(
                    0.0, self.misconception_strengths[facet] * (1.0 - profile.source_remediation_rate)
                )
        p_know_item = sum(
            weight * self.mastery_at(facet, day)
            for facet, weight in normalized_item_weights.items()
        )
        if primed:
            p_know_item = max(p_know_item, profile.priming_level)

        # Don't-know escape hatch: exercised before any guessing. A primed
        # student never reaches it (the working-memory floor sits above it).
        if p_know_item < profile.dont_know_threshold and rng.random() < profile.dont_know_propensity:
            latency = self._latency(rng, p_know_item)
            return SimOutcome(
                dont_know=True,
                criterion_points={criterion_id: 0.0 for criterion_id, _pts, _w in criteria},
                hints_used=0,
                latency_seconds=latency,
                confidence=1,
                attributions=[],
                p_correct_truth=p_know_item,
                misconception_fired=None,
            )

        # Misconception firing: pick the strongest planted misconception whose
        # facet is meaningfully tested by this item.
        fired: Misconception | None = None
        for facet, weight in normalized_item_weights.items():
            planted = self._misconceptions_by_facet.get(facet)
            if planted is None or weight < _MISCONCEPTION_MIN_WEIGHT:
                continue
            strength = self.misconception_strengths.get(facet, 0.0)
            if strength <= 0:
                continue
            if rng.random() < strength and (fired is None or strength > self.misconception_strengths.get(fired.facet_id, 0.0)):
                fired = planted

        hints_used = 0
        if hints_available > 0 and rng.random() < profile.hint_propensity * (1.0 - p_know_item):
            hints_used = 1

        criterion_points: dict[str, float] = {}
        attributions: list[SimAttribution] = []
        earned = 0.0
        max_total = 0.0
        for criterion_id, max_points, criterion_weights in criteria:
            weights = _normalize(criterion_weights) or normalized_item_weights
            max_total += max_points
            if fired is not None and weights.get(fired.facet_id, 0.0) >= _MISCONCEPTION_MIN_WEIGHT:
                # Systematic, confident error on criteria touching the facet.
                criterion_points[criterion_id] = 0.0
                continue
            p_know = sum(weight * self.mastery_at(facet, day) for facet, weight in weights.items())
            if primed:
                p_know = max(p_know, profile.priming_level)
            if hints_used:
                p_know = min(1.0, p_know + 0.15)  # a hint scaffolds the recall
            p_correct = profile.guess + max(0.0, 1.0 - profile.slip - profile.guess) * p_know
            if rng.random() < p_correct:
                criterion_points[criterion_id] = float(max_points)
                earned += max_points
            elif rng.random() < _PARTIAL_CREDIT_PROBABILITY:
                points = round(0.5 * max_points, 2)
                criterion_points[criterion_id] = points
                earned += points
            else:
                criterion_points[criterion_id] = 0.0

        correctness = earned / max_total if max_total > 0 else 0.0

        if fired is not None:
            strength = self.misconception_strengths.get(fired.facet_id, fired.strength)
            attributions.append(
                SimAttribution(
                    error_type=fired.error_type,
                    severity=min(1.0, fired.severity + 0.2 * strength),
                    is_misconception=True,
                    target_facets=(fired.facet_id,),
                    evidence=f"Systematic error consistent with {fired.error_type}.",
                )
            )
            # Corrective feedback after the attempt weakens the misconception.
            self.misconception_strengths[fired.facet_id] = max(
                0.0, strength * (1.0 - profile.misconception_remediation_rate)
            )
        elif correctness < 0.4 and rng.random() < 0.6:
            # Garden-variety failure: the grader attributes a recall failure.
            attributions.append(
                SimAttribution(
                    error_type="recall_failure",
                    severity=0.5,
                    is_misconception=False,
                    target_facets=tuple(sorted(normalized_item_weights)),
                )
            )

        confidence = self._confidence(rng, correctness, misconception_fired=fired is not None)
        latency = self._latency(rng, p_know_item)
        return SimOutcome(
            dont_know=False,
            criterion_points=criterion_points,
            hints_used=hints_used,
            latency_seconds=latency,
            confidence=confidence,
            attributions=attributions,
            p_correct_truth=p_know_item,
            misconception_fired=fired.error_type if fired is not None else None,
        )

    def teach_back_answer(
        self,
        *,
        day: float,
        tier: str,
        criterion_weights: Mapping[str, float],
        item_facet_weights: Mapping[str, float],
        max_points: float,
    ) -> SimTeachBackAnswer:
        """Answer one teach-back follow-up targeting a single rubric criterion.

        Correctness is drawn from true per-facet mastery through the same
        slip/guess machinery as :meth:`attempt`. Transfer-tier questions probe
        beyond the taught surface, so effective P(know) is reduced by
        ``profile.transfer_difficulty_delta`` before the Bernoulli draw. A
        failed answer still earns half credit with the usual small probability
        (partial understanding).
        """

        rng = self.rng
        profile = self.profile
        weights = _normalize(criterion_weights) or _normalize(item_facet_weights)
        p_know = sum(weight * self.mastery_at(facet, day) for facet, weight in weights.items())
        if tier == "transfer":
            p_know = max(0.0, p_know - profile.transfer_difficulty_delta)
        p_correct = profile.guess + max(0.0, 1.0 - profile.slip - profile.guess) * p_know
        if rng.random() < p_correct:
            points = float(max_points)
        elif rng.random() < _PARTIAL_CREDIT_PROBABILITY:
            points = round(0.5 * float(max_points), 2)
        else:
            points = 0.0
        latency = self._latency(rng, p_know)
        answer_md = f"[sim teach-back answer tier={tier} p_know={p_know:.2f} points={points:g}]"
        return SimTeachBackAnswer(
            points_awarded=points,
            p_know_effective=p_know,
            latency_seconds=latency,
            answer_md=answer_md,
        )

    # -- helpers ---------------------------------------------------------

    def _confidence(self, rng, correctness: float, *, misconception_fired: bool) -> int:
        profile = self.profile
        if misconception_fired:
            # The defining trait: confidently wrong.
            signal = 0.9
        else:
            noise = (rng.random() - 0.5) * (1.0 - profile.confidence_calibration)
            signal = correctness + noise
        signal = min(1.0, max(0.0, signal + profile.confidence_bias))
        return max(1, min(5, 1 + int(signal * 4.999)))

    def _latency(self, rng, p_know: float) -> int:
        base = 20.0 + 60.0 * (1.0 - p_know)
        return int(max(3.0, rng.expovariate(1.0 / base)))


def _normalize(weights: Mapping[str, float]) -> dict[str, float]:
    cleaned = {str(facet): max(float(weight), 0.0) for facet, weight in weights.items()}
    total = sum(cleaned.values())
    if total <= 0:
        if not cleaned:
            return {}
        share = 1.0 / len(cleaned)
        return {facet: share for facet in cleaned}
    return {facet: weight / total for facet, weight in cleaned.items()}
