"""Student profile presets and YAML loading.

A profile YAML mirrors :class:`learnloop.sim.student.StudentProfile`:

.. code-block:: yaml

    name: my_student
    true_mastery: 0.5          # default ground-truth mastery per facet
    learning_rate: 0.15        # gain per practice toward 1.0
    forgetting_halflife_days: 30
    slip: 0.05
    guess: 0.08
    hint_propensity: 0.25
    confidence_calibration: 0.8   # 1.0 = confidence tracks correctness exactly
    confidence_bias: 0.0
    transfer_difficulty_delta: 0.2  # teach-back transfer questions are harder
    misconceptions:
      - facet_id: sign_convention   # or "auto" -> most-tested facet in the vault
        error_type: sign_error
        strength: 0.85
    facets:                       # per-facet overrides (all keys optional)
      recall: {true_mastery: 0.7}

Misconception ``facet_id: auto`` is resolved by the runner against the loaded
vault (most-weighted evidence facet), so built-in profiles work on any vault.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from learnloop.sim.student import FacetParams, Misconception, StudentProfile

AUTO_FACET = "auto"

PLANTED_ERROR_TYPE = "sim_planted_misconception"


def _novice() -> StudentProfile:
    return StudentProfile(
        name="novice",
        true_mastery=0.15,
        learning_rate=0.28,
        forgetting_halflife_days=20.0,
        slip=0.05,
        guess=0.10,
        hint_propensity=0.5,
        confidence_calibration=0.7,
        dont_know_propensity=0.6,
    )


def _intermediate_with_misconception() -> StudentProfile:
    return StudentProfile(
        name="intermediate_with_misconception",
        true_mastery=0.6,
        learning_rate=0.12,
        forgetting_halflife_days=30.0,
        slip=0.05,
        guess=0.08,
        hint_propensity=0.2,
        confidence_calibration=0.85,
        misconceptions=[
            Misconception(
                facet_id=AUTO_FACET,
                error_type=PLANTED_ERROR_TYPE,
                strength=0.85,
                severity=0.75,
            )
        ],
    )


def _strong_forgetter() -> StudentProfile:
    return StudentProfile(
        name="strong_forgetter",
        true_mastery=0.85,
        learning_rate=0.2,
        forgetting_halflife_days=4.0,
        slip=0.04,
        guess=0.08,
        hint_propensity=0.15,
        confidence_calibration=0.8,
    )


def _overconfident() -> StudentProfile:
    return StudentProfile(
        name="overconfident",
        true_mastery=0.45,
        learning_rate=0.12,
        forgetting_halflife_days=25.0,
        slip=0.06,
        guess=0.10,
        hint_propensity=0.05,
        confidence_calibration=0.2,
        confidence_bias=0.35,
        dont_know_propensity=0.1,
    )


BUILTIN_PROFILES: dict[str, Any] = {
    "novice": _novice,
    "intermediate_with_misconception": _intermediate_with_misconception,
    "strong_forgetter": _strong_forgetter,
    "overconfident": _overconfident,
}


class ProfileError(ValueError):
    pass


def profile_from_mapping(payload: Mapping[str, Any]) -> StudentProfile:
    known = {
        "name",
        "true_mastery",
        "learning_rate",
        "forgetting_halflife_days",
        "forgetting_floor",
        "slip",
        "guess",
        "hint_propensity",
        "confidence_calibration",
        "confidence_bias",
        "dont_know_threshold",
        "dont_know_propensity",
        "misconception_remediation_rate",
        "transfer_difficulty_delta",
    }
    unknown = set(payload) - known - {"misconceptions", "facets"}
    if unknown:
        raise ProfileError(f"unknown profile keys: {', '.join(sorted(unknown))}")
    kwargs: dict[str, Any] = {key: payload[key] for key in known if key in payload}
    misconceptions = []
    for entry in payload.get("misconceptions") or []:
        if not isinstance(entry, Mapping) or "facet_id" not in entry or "error_type" not in entry:
            raise ProfileError("each misconception needs facet_id and error_type")
        misconceptions.append(
            Misconception(
                facet_id=str(entry["facet_id"]),
                error_type=str(entry["error_type"]),
                strength=float(entry.get("strength", 0.85)),
                severity=float(entry.get("severity", 0.7)),
            )
        )
    facets: dict[str, FacetParams] = {}
    for facet_id, override in (payload.get("facets") or {}).items():
        if not isinstance(override, Mapping):
            raise ProfileError(f"facet override for {facet_id} must be a mapping")
        facets[str(facet_id)] = FacetParams(
            true_mastery=_optional_float(override.get("true_mastery")),
            learning_rate=_optional_float(override.get("learning_rate")),
            forgetting_halflife_days=_optional_float(override.get("forgetting_halflife_days")),
        )
    return StudentProfile(misconceptions=misconceptions, facets=facets, **kwargs)


def _optional_float(value: Any) -> float | None:
    return None if value is None else float(value)


def load_profile(name_or_path: str) -> StudentProfile:
    """Resolve a built-in profile name or a YAML file path."""

    factory = BUILTIN_PROFILES.get(name_or_path)
    if factory is not None:
        return factory()
    path = Path(name_or_path)
    if path.exists() and path.suffix in (".yaml", ".yml"):
        from learnloop.vault.yaml_io import read_yaml

        payload = read_yaml(path)
        payload.setdefault("name", path.stem)
        return profile_from_mapping(payload)
    raise ProfileError(
        f"unknown profile {name_or_path!r}: expected one of "
        f"{', '.join(sorted(BUILTIN_PROFILES))} or a YAML file path"
    )
