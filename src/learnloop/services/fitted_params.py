"""Resolution of fitted parameter sets (architecture_pivot.md Stage 1).

Consumers resolve the active fitted set per operation — no in-process caching,
so the long-running sidecar never serves stale parameters and replay is
deterministic-by-construction (it uses whatever set is active at replay time,
auditable via the fitted_parameters history rows).
"""

from __future__ import annotations

import math
from typing import Any

from learnloop.db.repositories import Repository
from learnloop.services.fsrs import FSRS6_DEFAULT_WEIGHTS

FSRS_WEIGHTS_SCOPE = "fsrs_weights"
FOLLOWUP_GATE_SCOPE = "followup_gate"


def resolve_fsrs_weights(repository: Repository) -> tuple[float, ...]:
    """Active fitted FSRS weights, else the pinned FSRS-6 defaults.

    Hard-validates the payload (21 finite floats); any malformed fitted row
    falls back to defaults rather than crashing the attempt path.
    """

    record = repository.active_fitted_parameters(FSRS_WEIGHTS_SCOPE)
    if record is None:
        return FSRS6_DEFAULT_WEIGHTS
    weights = _validated_weights(record.get("params", {}))
    if weights is None:
        return FSRS6_DEFAULT_WEIGHTS
    return weights


def fitted_fsrs_provenance(repository: Repository) -> str | None:
    """Fitted-set id when fitted weights are active and valid, else None."""

    record = repository.active_fitted_parameters(FSRS_WEIGHTS_SCOPE)
    if record is None or _validated_weights(record.get("params", {})) is None:
        return None
    return record["id"]


def _validated_weights(params: dict[str, Any]) -> tuple[float, ...] | None:
    raw = params.get("weights")
    if not isinstance(raw, (list, tuple)) or len(raw) != len(FSRS6_DEFAULT_WEIGHTS):
        return None
    values: list[float] = []
    for entry in raw:
        if isinstance(entry, bool) or not isinstance(entry, (int, float)) or not math.isfinite(entry):
            return None
        values.append(float(entry))
    return tuple(values)
