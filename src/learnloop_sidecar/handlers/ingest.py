from __future__ import annotations

from typing import Any

from learnloop_sidecar.context import SidecarContext
from learnloop_sidecar.dto import versioned
from learnloop_sidecar.registry import method

# How many recent ingests the screen shows; the vault keeps everything.
_RECENT_LIMIT = 30


def _note_path_from_ref(ref: Any) -> str | None:
    if not isinstance(ref, dict) or ref.get("ref_type") != "canonical_source":
        return None
    path = ref.get("path")
    if not isinstance(path, str) or not path:
        return None
    # Unresolved-locator refs suffix the note path with "#<detail>".
    return path.split("#", 1)[0]


@method("get_recent_ingests")
def get_recent_ingests(ctx: SidecarContext, _params) -> dict[str, Any]:
    """Canonical-source notes staged by `learnloop ingest` / `ingest-exam`.

    One entry per canonical_source note, newest first, joined against the
    proposal batch that the ingest produced (when one exists) so the UI can
    distinguish exam ingests and deep-link into the Proposals screen.
    """

    vault, repository = ctx.require_vault()

    batch_by_note_path: dict[str, dict[str, Any]] = {}
    for batch in repository.proposal_batches():
        if batch.get("purpose") not in {"canonical_ingest", "exam_ingest"}:
            continue
        for ref in batch.get("source_refs") or []:
            path = _note_path_from_ref(ref)
            # proposal_batches() is newest-first; keep the newest batch per note.
            if path and path not in batch_by_note_path:
                batch_by_note_path[path] = batch

    entries: list[dict[str, Any]] = []
    for note in vault.notes.values():
        if note.source_type != "canonical_source":
            continue
        metadata = getattr(note, "model_extra", {}) or {}
        canonical_source = metadata.get("canonical_source")
        if not isinstance(canonical_source, dict):
            canonical_source = {}
        batch = batch_by_note_path.get(note.path or "")
        entries.append(
            {
                "note_id": note.id,
                "path": note.path,
                "subject_id": note.subjects[0] if note.subjects else None,
                "title": canonical_source.get("title") or note.id,
                "kind": canonical_source.get("kind"),
                "canonical_uri": canonical_source.get("canonical_uri"),
                "authors": canonical_source.get("authors") or [],
                "retrieved_at": canonical_source.get("retrieved_at"),
                "created_at": note.created_at,
                "patch_id": batch["id"] if batch else None,
                "purpose": batch["purpose"] if batch else "canonical_ingest",
            }
        )

    entries.sort(key=lambda e: e.get("created_at") or e.get("retrieved_at") or "", reverse=True)
    return versioned({"ingests": entries[:_RECENT_LIMIT]})
