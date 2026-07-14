"""Open-in-source span view (spec_source_ingestion_v2 §9.2).

Resolves a ``block_span_v1`` locator (``extraction_id`` + ``span_id``) to the
geometry and text the read-only viewer renders, and records a
``source_exposure`` event on EVERY view (§14). The viewer is minimal by design:

* PDF spans carry a page + bbox/polygon. No page raster is persisted anywhere in
  the source layer (``source_document_assets`` stores extracted figures, not page
  images), so ``page_render`` is always ``None`` and ``viewer_mode`` is
  ``pdf_text`` — the frontend outlines the span TEXT with page/region chrome
  ("text view — page N, region highlighted"). An honest fallback, labelled.
* HTML / plaintext spans have no page geometry; ``viewer_mode`` is
  ``text_anchor`` and the frontend scrolls to the block anchor and highlights it.

Neighboring spans (ordinal-adjacent blocks) are returned so prev/next paging and
multi-span page context work without a second round-trip.
"""

from __future__ import annotations

from typing import Any

from learnloop.clock import Clock
from learnloop.db.repositories import Repository

# How many ordinal-adjacent blocks to return on each side for prev/next paging.
_NEIGHBOR_RADIUS = 3
# Neighbor previews are truncated; the focused span returns full text.
_NEIGHBOR_CHAR_CAP = 240

_VALID_CONTEXTS = {
    "provenance",
    "gate_diagnostic",
    "registry_review",
    "library",
    "other",
    # ING M8 (§9.2, §11): tutor-citation click-through, provenance-panel open, and
    # conflict-review span open all record exposure with their own discriminator.
    "tutor_citation",
    "provenance_panel",
    "conflict_review",
}


class SpanViewError(ValueError):
    """Typed failure for the get_span_view RPC."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _neighbor(block: Any) -> dict[str, Any]:
    text = block.text or ""
    truncated = text[:_NEIGHBOR_CHAR_CAP]
    return {
        "span_id": block.span_id,
        "block_type": block.block_type,
        "page": block.page,
        "ordinal": block.ordinal,
        "text": truncated,
        "truncated": len(truncated) < len(text),
    }


def build_span_view(
    repo: Repository,
    extraction_id: str,
    span_id: str,
    *,
    context: str = "other",
    entity_type: str | None = None,
    entity_id: str | None = None,
    record: bool = True,
    clock: Clock | None = None,
) -> dict[str, Any]:
    """Resolve a span to viewer geometry + text and record a source_exposure event."""

    if context not in _VALID_CONTEXTS:
        context = "other"

    ir = repo.load_document_ir(extraction_id)
    if ir is None:
        raise SpanViewError("extraction_not_found", f"No extraction IR for '{extraction_id}'.")
    block = ir.block_by_span(span_id)
    if block is None:
        raise SpanViewError("span_not_found", f"Span '{span_id}' not found in extraction '{extraction_id}'.")

    # Resolve the source chain for chrome + external-open fallback.
    run = repo.get_extraction_run(extraction_id)
    revision_id = run.get("revision_id") if run else None
    revision = repo.get_source_revision(revision_id) if revision_id else None
    source_id = revision.get("source_id") if revision else None
    original_uri = revision.get("original_uri") if revision else None
    artifact = repo.get_source_artifact(source_id) if source_id else None
    acquisition_kind = artifact.get("acquisition_kind") if artifact else None
    canonical_uri = artifact.get("canonical_uri") if artifact else None

    ordered = sorted(ir.blocks, key=lambda candidate: candidate.ordinal)
    index = next((i for i, candidate in enumerate(ordered) if candidate.span_id == span_id), None)
    previous_blocks: list[dict[str, Any]] = []
    next_blocks: list[dict[str, Any]] = []
    if index is not None:
        previous_blocks = [_neighbor(b) for b in ordered[max(0, index - _NEIGHBOR_RADIUS):index]]
        next_blocks = [_neighbor(b) for b in ordered[index + 1:index + 1 + _NEIGHBOR_RADIUS]]

    has_geometry = block.page is not None and bool(block.bbox)
    viewer_mode = "pdf_text" if has_geometry else "text_anchor"
    # Every span on the focused page (multi-span highlight on one page).
    same_page_spans: list[dict[str, Any]] = []
    if block.page is not None:
        same_page_spans = [
            {"span_id": b.span_id, "bbox": b.bbox, "polygon": b.polygon}
            for b in ordered
            if b.page == block.page and b.bbox
        ]

    locator = f"span:{span_id}"
    exposure_event_id: str | None = None
    if record:
        exposure_event_id = repo.insert_source_exposure_event(
            {
                "context": context,
                "extraction_id": extraction_id,
                "span_id": span_id,
                "revision_id": revision_id,
                "source_id": source_id,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "page": block.page,
                "locator": locator,
                "section_path": list(block.section_path),
            },
            clock=clock,
        )

    return {
        "extraction_id": extraction_id,
        "span_id": span_id,
        "source_id": source_id,
        "revision_id": revision_id,
        "original_uri": original_uri,
        "canonical_uri": canonical_uri,
        "acquisition_kind": acquisition_kind,
        "viewer_mode": viewer_mode,
        "block_type": block.block_type,
        "page": block.page,
        "bbox": block.bbox,
        "polygon": block.polygon,
        "section_path": list(block.section_path),
        "text": block.text,
        "locator": locator,
        "locator_scheme": "block_span_v1",
        # No page raster is persisted — the viewer renders the honest text fallback.
        "page_render": None,
        "page_spans": same_page_spans,
        "previous_spans": previous_blocks,
        "next_spans": next_blocks,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "exposure_event_id": exposure_event_id,
    }
