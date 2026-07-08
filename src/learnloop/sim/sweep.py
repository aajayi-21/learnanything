"""Config sensitivity sweep: which knobs actually change scheduling decisions.

For each ``{param_path, values}`` entry the sweep re-runs the same simulation
(same vault content, profile, seed, days) with one config override applied to a
fresh vault copy, then compares against the baseline run:

- **queue-order divergence**: mean daily top-K overlap (K = items practiced per
  day) and mean Kendall-tau over the common items of each day's full queue;
- **count deltas**: follow-ups, error events, resolutions, don't-knows;
- **metric deltas**: belief MAE, predictive log-loss, misconception detection day.

The verdict per (param, value) is "decision-relevant" when the queues actually
moved or the counts changed, otherwise "inert in this scenario" -- with the
numbers attached so the call is auditable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from learnloop.sim.runner import (
    SimReport,
    SimulationError,
    prepare_run_vault,
    run_simulation,
)
from learnloop.sim.student import StudentProfile

DEFAULT_SWEEP_SPEC_PATH = Path(__file__).with_name("default_sweep.yaml")

_TOPK_OVERLAP_RELEVANCE = 0.98
_KENDALL_RELEVANCE = 0.95
_MAE_RELEVANCE = 0.005
_GOAL_RELEVANCE = 0.01  # min |delta| in goal attainment/retention fractions


@dataclass(frozen=True)
class SweepEntry:
    param_path: str
    values: list[Any]


@dataclass
class SweepReport:
    baseline: dict[str, Any]
    results: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"version": 1, "baseline": self.baseline, "results": self.results}


class SweepSpecError(ValueError):
    pass


def load_sweep_spec(path: Path | None = None) -> list[SweepEntry]:
    """Load a sweep spec YAML: ``{"sweeps": [{"param_path": ..., "values": [...]}]}``."""

    from learnloop.vault.yaml_io import read_yaml

    payload = read_yaml(path or DEFAULT_SWEEP_SPEC_PATH)
    raw_entries = payload.get("sweeps")
    if not isinstance(raw_entries, list) or not raw_entries:
        raise SweepSpecError("sweep spec must contain a non-empty 'sweeps' list")
    entries: list[SweepEntry] = []
    for raw in raw_entries:
        if not isinstance(raw, Mapping) or "param_path" not in raw or "values" not in raw:
            raise SweepSpecError("each sweep entry needs 'param_path' and 'values'")
        values = list(raw["values"])
        if not values:
            raise SweepSpecError(f"sweep entry {raw['param_path']} has no values")
        entries.append(SweepEntry(param_path=str(raw["param_path"]), values=values))
    return entries


def run_sweep(
    vault_root: Path,
    profile: StudentProfile,
    *,
    sweep_spec: list[SweepEntry],
    days: int = 30,
    items_per_day: int = 6,
    seed: int = 42,
    work_dir: Path,
    reset_state: bool = True,
    base_overrides: Mapping[str, Any] | None = None,
    primed_retries: bool = False,
    goal_due_day: int | None = None,
) -> SweepReport:
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    base_overrides = dict(base_overrides or {})

    def _run(name: str, overrides: Mapping[str, Any]) -> SimReport:
        run_root = prepare_run_vault(vault_root, work_dir / name, reset_state=reset_state)
        return run_simulation(
            run_root,
            profile,
            days=days,
            items_per_day=items_per_day,
            seed=seed,
            config_overrides=overrides,
            primed_retries=primed_retries,
            goal_due_day=goal_due_day,
        )

    baseline = _run("baseline", base_overrides)
    report = SweepReport(baseline=_run_summary(baseline))
    for entry_index, entry in enumerate(sweep_spec):
        for value_index, value in enumerate(entry.values):
            overrides = dict(base_overrides)
            overrides[entry.param_path] = value
            name = f"sweep_{entry_index:02d}_{value_index:02d}"
            try:
                variant = _run(name, overrides)
            except SimulationError as exc:
                report.results.append(
                    {
                        "param_path": entry.param_path,
                        "value": value,
                        "error": str(exc),
                        "verdict": "error",
                    }
                )
                continue
            report.results.append(_compare(entry.param_path, value, baseline, variant))
    return report


# -- comparison ----------------------------------------------------------------


def _compare(
    param_path: str, value: Any, baseline: SimReport, variant: SimReport
) -> dict[str, Any]:
    topk_overlaps: list[float] = []
    kendalls: list[float] = []
    for base_day, variant_day in zip(baseline.day_records, variant.day_records, strict=False):
        topk_overlaps.append(
            _overlap(base_day.practiced_item_ids, variant_day.practiced_item_ids)
        )
        tau = _kendall_tau(base_day.queue_item_ids, variant_day.queue_item_ids)
        if tau is not None:
            kendalls.append(tau)
    mean_topk = _mean(topk_overlaps)
    mean_kendall = _mean(kendalls)

    base_counts = baseline.metrics.get("counts", {})
    variant_counts = variant.metrics.get("counts", {})
    count_deltas = {
        key: (variant_counts.get(key, 0) or 0) - (base_counts.get(key, 0) or 0)
        for key in (
            "followups_triggered",
            "probe_attempts",
            "dont_know_attempts",
            "teach_back_attempts",
            "error_events_created",
            "error_events_resolved",
        )
    }
    metric_deltas = {
        "belief_mae": _delta(
            baseline.metrics.get("belief_vs_truth", {}).get("mae"),
            variant.metrics.get("belief_vs_truth", {}).get("mae"),
        ),
        "log_loss": _delta(
            baseline.metrics.get("calibration", {}).get("log_loss"),
            variant.metrics.get("calibration", {}).get("log_loss"),
        ),
        "first_misconception_detection_day": _delta(
            _first_detection_day(baseline),
            _first_detection_day(variant),
        ),
        # The cram-vs-space tradeoff a goal quota makes: due-date attainment
        # (fraction of goal facets at true mastery >= target on the due day)
        # against retention 30 no-practice days later.
        "goal_attainment_at_due": _delta(
            _goal_metric_mean(baseline, "truth_at_target_fraction_at_due"),
            _goal_metric_mean(variant, "truth_at_target_fraction_at_due"),
        ),
        "goal_retention_due_plus_30": _delta(
            _goal_metric_mean(baseline, "truth_at_target_fraction_due_plus_30"),
            _goal_metric_mean(variant, "truth_at_target_fraction_due_plus_30"),
        ),
        "goal_frontier_empty_day": _delta(
            _goal_metric_mean(baseline, "frontier_empty_day"),
            _goal_metric_mean(variant, "frontier_empty_day"),
        ),
    }

    queue_moved = (mean_topk is not None and mean_topk < _TOPK_OVERLAP_RELEVANCE) or (
        mean_kendall is not None and mean_kendall < _KENDALL_RELEVANCE
    )
    counts_moved = any(delta != 0 for delta in count_deltas.values())
    beliefs_moved = (
        metric_deltas["belief_mae"] is not None
        and abs(metric_deltas["belief_mae"]) > _MAE_RELEVANCE
    )
    goals_moved = any(
        metric_deltas[key] is not None and abs(metric_deltas[key]) > _GOAL_RELEVANCE
        for key in ("goal_attainment_at_due", "goal_retention_due_plus_30")
    )
    decision_relevant = queue_moved or counts_moved or beliefs_moved or goals_moved
    return {
        "param_path": param_path,
        "value": value,
        "mean_topk_overlap": _round(mean_topk),
        "mean_kendall_tau": _round(mean_kendall),
        "count_deltas": count_deltas,
        "metric_deltas": {key: _round(delta) for key, delta in metric_deltas.items()},
        "verdict": "decision-relevant" if decision_relevant else "inert in this scenario",
        "signals": {
            "queue_moved": queue_moved,
            "counts_moved": counts_moved,
            "beliefs_moved": bool(beliefs_moved),
            "goals_moved": bool(goals_moved),
        },
    }


def _goal_metric_mean(report: SimReport, key: str) -> float | None:
    per_goal = report.metrics.get("goals", {}).get("per_goal", [])
    values = [entry.get(key) for entry in per_goal if entry.get(key) is not None]
    if not values:
        return None
    return sum(values) / len(values)


def _run_summary(report: SimReport) -> dict[str, Any]:
    return {
        "profile": report.profile.get("name"),
        "seed": report.seed,
        "days": report.days,
        "items_per_day": report.items_per_day,
        "config_overrides": report.config_overrides,
        "metrics": report.metrics,
    }


def _first_detection_day(report: SimReport) -> float | None:
    planted = report.metrics.get("misconceptions", {}).get("planted", [])
    days = [
        entry.get("first_error_event_day")
        for entry in planted
        if entry.get("first_error_event_day") is not None
    ]
    return min(days) if days else None


def _overlap(left: list[str], right: list[str]) -> float:
    if not left and not right:
        return 1.0
    left_set, right_set = set(left), set(right)
    denominator = max(len(left_set), len(right_set))
    if denominator == 0:
        return 1.0
    return len(left_set & right_set) / denominator


def _kendall_tau(left: list[str], right: list[str]) -> float | None:
    """Kendall tau over the ranks of items present in both queue orders."""

    common = [item for item in left if item in set(right)]
    if len(common) < 2:
        return None
    right_rank = {item: index for index, item in enumerate(right)}
    ranks = [right_rank[item] for item in common]
    concordant = discordant = 0
    for i in range(len(ranks)):
        for j in range(i + 1, len(ranks)):
            if ranks[i] < ranks[j]:
                concordant += 1
            elif ranks[i] > ranks[j]:
                discordant += 1
    total = concordant + discordant
    if total == 0:
        return 1.0
    return (concordant - discordant) / total


def _delta(base: float | None, variant: float | None) -> float | None:
    if base is None or variant is None:
        return None
    return variant - base


def _mean(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _round(value: float | None, digits: int = 6) -> float | None:
    return None if value is None else round(value, digits)
