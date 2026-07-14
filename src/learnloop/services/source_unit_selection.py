"""Unit selection persistence with re-anchoring (spec_source_ingestion_v2 §5.3).

The learner chooses which units of an extraction feed synthesis, and may override
unit boundaries (merge adjacent units / split a unit at a heading). Selections and
overrides are stored per (artifact, revision, extraction) and MUST survive a
re-extraction: on a new ExtractionRun the old selection is re-anchored onto the new
units deterministically via M1's re-anchor machinery (semantic-hash / unit-id
match, span-alias fallback). Anything that cannot be re-anchored is **flagged for
review — never silently dropped** (§5.3, §14 selection-survival row).

Pure/deterministic: no fetch, no extraction, no LLM.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from learnloop.clock import Clock
from learnloop.db.repositories import Repository
from learnloop.ingest.ir import DocumentIR
from learnloop.ingest.reanchor import reanchor_spans

# Boundary-override operations a user can layer over the ExtractionRun (§5.3).
MERGE_WITH_NEXT = "merge_with_next"
SPLIT_AT_HEADING = "split_at_heading"
_OVERRIDE_OPS = {MERGE_WITH_NEXT, SPLIT_AT_HEADING}


class SelectionValidationError(ValueError):
    """A selection or boundary override references units/spans that don't exist."""


@dataclass
class ReanchoredSelection:
    selected_unit_ids: list[str] = field(default_factory=list)
    boundary_overrides: list[dict] = field(default_factory=list)
    needs_review: list[str] = field(default_factory=list)


def _override_unit_id(override: dict) -> str | None:
    return override.get("unit_id") if override.get("unit_id") is not None else override.get("unitId")


def _override_at_span(override: dict) -> str | None:
    return override.get("at_span_id") if override.get("at_span_id") is not None else override.get("atSpanId")


def normalize_overrides(boundary_overrides: list[dict] | None) -> list[dict]:
    """Normalize free-form override dicts to canonical snake_case keys.

    The overrides arrive as free-form JSON from the frontend (camelCase) or CLI
    (snake_case); we store one canonical shape so downstream code and re-anchoring
    read a single key set."""

    normalized: list[dict] = []
    for override in boundary_overrides or []:
        entry = {"op": override.get("op"), "unit_id": _override_unit_id(override)}
        at_span = _override_at_span(override)
        if at_span is not None:
            entry["at_span_id"] = at_span
        normalized.append(entry)
    return normalized


def validate_unit_selection(
    ir: DocumentIR,
    selected_unit_ids: list[str],
    boundary_overrides: list[dict] | None = None,
) -> None:
    """App-level validation of a selection against its extraction's IR."""

    unit_ids = {unit.unit_id for unit in ir.units}
    span_ids = {block.span_id for block in ir.blocks}
    seen: set[str] = set()
    for unit_id in selected_unit_ids:
        if unit_id not in unit_ids:
            raise SelectionValidationError(f"unit '{unit_id}' is not in extraction units.")
        if unit_id in seen:
            raise SelectionValidationError(f"unit '{unit_id}' selected more than once.")
        seen.add(unit_id)
    for override in normalize_overrides(boundary_overrides):
        op = override.get("op")
        if op not in _OVERRIDE_OPS:
            raise SelectionValidationError(f"unknown boundary-override op '{op}'.")
        target = override.get("unit_id")
        if target not in unit_ids:
            raise SelectionValidationError(f"boundary override targets missing unit '{target}'.")
        at_span = override.get("at_span_id")
        if op == SPLIT_AT_HEADING and at_span is not None and at_span not in span_ids:
            raise SelectionValidationError(f"split references missing span '{at_span}'.")


def save_unit_selection(
    repo: Repository,
    extraction_id: str,
    selected_unit_ids: list[str],
    *,
    boundary_overrides: list[dict] | None = None,
    clock: Clock | None = None,
) -> dict:
    """Validate and persist a selection for one extraction run."""

    ir = repo.load_document_ir(extraction_id)
    if ir is None:
        raise SelectionValidationError(f"extraction '{extraction_id}' has no persisted IR.")
    validate_unit_selection(ir, selected_unit_ids, boundary_overrides)
    run = repo.get_extraction_run(extraction_id)
    revision_id = run["revision_id"] if run else None
    revision = repo.get_source_revision(revision_id) if revision_id else None
    source_id = revision["source_id"] if revision else None
    repo.upsert_unit_selection(
        extraction_id=extraction_id,
        source_id=source_id,
        revision_id=revision_id,
        selected_unit_ids=list(selected_unit_ids),
        boundary_overrides=normalize_overrides(boundary_overrides),
        needs_review=[],
        clock=clock,
    )
    return repo.get_unit_selection(extraction_id) or {}


def reanchor_units(from_ir: DocumentIR, to_ir: DocumentIR) -> dict[str, str | None]:
    """Map each old unit id onto a new unit id (or ``None`` when unresolved).

    Resolution order (§5.3): exact unit-id + semantic-hash match, then a unique
    semantic-hash match, then M1 span-alias majority. A tie stays unresolved."""

    to_by_id = {unit.unit_id: unit for unit in to_ir.units}
    to_by_hash: dict[str, list] = {}
    for unit in to_ir.units:
        to_by_hash.setdefault(unit.semantic_hash, []).append(unit)
    span_result = reanchor_spans(from_ir, to_ir)
    to_unit_of_span: dict[str, str] = {}
    for unit in to_ir.units:
        for span_id in unit.span_ids:
            to_unit_of_span[span_id] = unit.unit_id

    resolved: dict[str, str | None] = {}
    for unit in from_ir.units:
        same_id = to_by_id.get(unit.unit_id)
        if same_id is not None and same_id.semantic_hash == unit.semantic_hash:
            resolved[unit.unit_id] = same_id.unit_id
            continue
        by_hash = to_by_hash.get(unit.semantic_hash, [])
        if len(by_hash) == 1:
            resolved[unit.unit_id] = by_hash[0].unit_id
            continue
        if len(by_hash) > 1:
            disambiguated = [c for c in by_hash if c.unit_id == unit.unit_id]
            resolved[unit.unit_id] = disambiguated[0].unit_id if len(disambiguated) == 1 else None
            continue
        resolved[unit.unit_id] = _span_majority_unit(unit, span_result, to_unit_of_span)
    return resolved


def _span_majority_unit(unit, span_result, to_unit_of_span) -> str | None:
    mapped: list[str] = []
    for span_id in unit.span_ids:
        alias = span_result.alias_for(span_id)
        if alias is not None:
            new_unit = to_unit_of_span.get(alias.to_span_id)
            if new_unit is not None:
                mapped.append(new_unit)
    if not mapped:
        return None
    counts = Counter(mapped)
    top_unit, top_n = counts.most_common(1)[0]
    ties = list(counts.values()).count(top_n)
    if ties == 1 and top_n * 2 > len(unit.span_ids):
        return top_unit
    return None


def reanchor_selection(
    from_ir: DocumentIR,
    to_ir: DocumentIR,
    selected_unit_ids: list[str],
    boundary_overrides: list[dict] | None = None,
) -> ReanchoredSelection:
    """Re-anchor a stored selection + overrides onto a fresh extraction (§5.3)."""

    unit_map = reanchor_units(from_ir, to_ir)
    result = ReanchoredSelection()
    for unit_id in selected_unit_ids:
        new_id = unit_map.get(unit_id)
        if new_id is not None:
            if new_id not in result.selected_unit_ids:
                result.selected_unit_ids.append(new_id)
        else:
            result.needs_review.append(unit_id)
    for override in boundary_overrides or []:
        remapped = dict(override)
        target = override.get("unit_id")
        new_target = unit_map.get(target)
        if new_target is None:
            result.needs_review.append(str(target))
            continue
        remapped["unit_id"] = new_target
        result.boundary_overrides.append(remapped)
    return result


def reanchor_selection_to(
    repo: Repository,
    from_extraction_id: str,
    to_extraction_id: str,
    *,
    clock: Clock | None = None,
) -> dict:
    """Re-anchor the stored selection of ``from`` onto ``to`` and persist it.

    Returns the new selection row (with any ``needs_review`` unit ids)."""

    stored = repo.get_unit_selection(from_extraction_id)
    if stored is None:
        raise SelectionValidationError(f"extraction '{from_extraction_id}' has no stored selection.")
    from_ir = repo.load_document_ir(from_extraction_id)
    to_ir = repo.load_document_ir(to_extraction_id)
    if from_ir is None or to_ir is None:
        raise SelectionValidationError("both extractions must have persisted IR to re-anchor.")
    reanchored = reanchor_selection(
        from_ir,
        to_ir,
        stored.get("selected_unit_ids") or [],
        stored.get("boundary_overrides") or [],
    )
    run = repo.get_extraction_run(to_extraction_id)
    revision_id = run["revision_id"] if run else None
    revision = repo.get_source_revision(revision_id) if revision_id else None
    source_id = revision["source_id"] if revision else None
    repo.upsert_unit_selection(
        extraction_id=to_extraction_id,
        source_id=source_id,
        revision_id=revision_id,
        selected_unit_ids=reanchored.selected_unit_ids,
        boundary_overrides=reanchored.boundary_overrides,
        needs_review=reanchored.needs_review,
        clock=clock,
    )
    return repo.get_unit_selection(to_extraction_id) or {}
