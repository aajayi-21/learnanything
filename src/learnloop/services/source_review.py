"""Resolve practice-item source refs into displayable canonical-source sections.

Feeds the feedback screen's source-review panel: after a miss, the learner sees
the exact section (or transcript time range) of the canonical source that the
practice item was extracted from. Resolution recomputes chunks from the note
body and matches the ref's locator — the same mechanism source change-detection
uses — so a restructured source degrades to the stored quote with a
``source_changed`` marker instead of silently showing a near-match.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from learnloop.services.source_ingestion import (
    SourceChunk,
    _caption_chunks_for_time_range,
    _child_chunks_for_locator,
    _chunks_for_note_body,
    _locator_hash_for_ref,
    _youtube_video_id,
)

# Cues of surrounding transcript context on each side of the matched range: a
# single caption cue is only a few seconds of speech, too little to re-learn from.
CAPTION_CONTEXT_CUES = 2

_DISPLAYABLE_REF_TYPES = {"canonical_source", "note"}


def resolve_source_refs(vault, item) -> list[dict[str, Any]]:
    """Resolve an item's source refs for display. One dict per displayable ref."""

    notes_by_id = vault.notes
    notes_by_path = {note.path: note for note in vault.notes.values() if note.path}
    resolved: list[dict[str, Any]] = []
    for ref in item.provenance.source_refs:
        if ref.ref_type not in _DISPLAYABLE_REF_TYPES:
            continue
        note = notes_by_id.get(ref.ref_id) or notes_by_path.get(ref.path)
        if note is None:
            resolved.append(_quote_fallback(ref, kind=None, note=None))
            continue
        metadata = getattr(note, "model_extra", {}) or {}
        canonical = metadata.get("canonical_source")
        canonical = canonical if isinstance(canonical, dict) else {}
        kind = canonical.get("kind") or "note"
        chunks = _chunks_for_note_body(kind, note.body)
        if kind == "youtube_video":
            resolved.append(_resolve_video_ref(ref, note, canonical, chunks))
        else:
            resolved.append(_resolve_text_ref(ref, note, canonical, kind, chunks))
    return resolved


def _base_entry(ref, kind: str | None, note, canonical: dict[str, Any] | None = None) -> dict[str, Any]:
    canonical = canonical or {}
    return {
        "ref_type": ref.ref_type,
        "kind": kind,
        "title": canonical.get("title") or (note.id if note is not None else ref.ref_id),
        "external_url": canonical.get("canonical_uri") or canonical.get("original_uri"),
        "note_path": note.path if note is not None else None,
        "locator": ref.locator,
        "locator_resolved": False,
        "source_changed": False,
        "heading_path": None,
        "section_md": None,
        "video": None,
    }


def _quote_fallback(ref, *, kind: str | None, note, canonical: dict[str, Any] | None = None) -> dict[str, Any]:
    entry = _base_entry(ref, kind, note, canonical)
    entry["section_md"] = ref.quote
    entry["source_changed"] = True
    return entry


def _resolve_text_ref(ref, note, canonical: dict[str, Any], kind: str, chunks: list[SourceChunk]) -> dict[str, Any]:
    if ref.locator is None:
        return _quote_fallback(ref, kind=kind, note=note, canonical=canonical)
    matched = [chunk for chunk in chunks if chunk.locator == ref.locator]
    if not matched:
        matched = _child_chunks_for_locator(chunks, ref.locator)
    if not matched:
        return _quote_fallback(ref, kind=kind, note=note, canonical=canonical)
    entry = _base_entry(ref, kind, note, canonical)
    entry["locator_resolved"] = True
    entry["heading_path"] = [part for part in matched[0].heading_path if part != "root"]
    entry["section_md"] = "\n\n".join(chunk.text for chunk in matched)
    # A resolving locator can still cover edited text; the stored quote hash is
    # the extraction-time fingerprint (same sha256 the change-detector uses).
    if ref.quote_hash:
        current_hash = _locator_hash_for_ref(chunks, ref.locator)
        entry["source_changed"] = current_hash is not None and current_hash != ref.quote_hash
    return entry


def _resolve_video_ref(ref, note, canonical: dict[str, Any], chunks: list[SourceChunk]) -> dict[str, Any]:
    entry = _base_entry(ref, "youtube_video", note, canonical)
    uri = canonical.get("original_uri") or canonical.get("canonical_uri") or ""
    video_id = _youtube_video_id(uri)
    time_range = _parse_time_locator_loose(ref.locator)
    if time_range is not None and video_id is not None:
        start, end = time_range
        entry["video"] = {"video_id": video_id, "start_seconds": start, "end_seconds": end}
    if ref.locator is None or time_range is None:
        return _quote_fallback(ref, kind="youtube_video", note=note, canonical=canonical) | {"video": entry["video"]}
    start, end = time_range
    captions = sorted(
        (chunk for chunk in chunks if chunk.chunk_kind == "caption"),
        key=lambda chunk: chunk.ordinal,
    )
    matched = _caption_chunks_for_time_range(chunks, f"t={start:.1f}-{end:.1f}" if end is not None else ref.locator)
    if not matched and end is None:
        # Bare t=start locator: take the cue containing (or first after) start.
        matched = [
            chunk
            for chunk in captions
            if (parsed := _parse_cue_range(chunk.locator)) is not None and parsed[0] <= start < parsed[1]
        ][:1]
    if not matched:
        return _quote_fallback(ref, kind="youtube_video", note=note, canonical=canonical) | {"video": entry["video"]}
    ordinals = {chunk.ordinal for chunk in matched}
    low, high = min(ordinals) - CAPTION_CONTEXT_CUES, max(ordinals) + CAPTION_CONTEXT_CUES
    window = [chunk for chunk in captions if low <= chunk.ordinal <= high]
    entry["locator_resolved"] = True
    entry["section_md"] = " ".join(chunk.text for chunk in window)
    if ref.quote_hash:
        text = "\n".join(chunk.text.strip() for chunk in matched)
        current_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        entry["source_changed"] = current_hash != ref.quote_hash
    return entry


def _parse_time_locator_loose(locator: str | None) -> tuple[float, float | None] | None:
    """``t=start-end`` -> (start, end); bare ``t=start`` -> (start, None)."""

    if locator is None:
        return None
    match = re.match(r"^t=([0-9]+(?:\.[0-9]+)?)(?:-([0-9]+(?:\.[0-9]+)?))?$", locator.strip())
    if not match:
        return None
    start = float(match.group(1))
    end = float(match.group(2)) if match.group(2) is not None else None
    if end is not None and end <= start:
        return None
    return start, end


def _parse_cue_range(locator: str) -> tuple[float, float] | None:
    match = re.match(r"^t=([0-9.]+)-([0-9.]+)$", locator)
    if not match:
        return None
    return float(match.group(1)), float(match.group(2))
