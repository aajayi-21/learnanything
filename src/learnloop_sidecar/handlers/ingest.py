from __future__ import annotations

from typing import Any, Literal

from learnloop.ingest.models import UnsupportedSourceError
from learnloop.ingest.resolution import resolve_source
from learnloop_sidecar.context import SidecarContext
from learnloop_sidecar.dto import ParamsModel, versioned
from learnloop_sidecar.errors import SidecarError
from learnloop_sidecar.ingest_jobs import ActiveIngestJobError
from learnloop_sidecar.registry import method

# How many recent ingests the screen shows; the vault keeps everything.
_RECENT_LIMIT = 30


class ClassifyIngestSourceInput(ParamsModel):
    source: str


class StartIngestInput(ParamsModel):
    source: str
    subject_id: str
    mode: Literal["canonical", "exam"] = "canonical"


class IngestJobInput(ParamsModel):
    job_id: str


@method("classify_ingest_source", ClassifyIngestSourceInput)
def classify_ingest_source(_ctx: SidecarContext, params: ClassifyIngestSourceInput) -> dict[str, Any]:
    try:
        resolved = resolve_source(params.source)
    except UnsupportedSourceError as exc:
        raise SidecarError("unsupported_source", str(exc)) from exc
    return versioned({"kind": resolved.category, "normalized_source": resolved.source})


@method("start_ingest", StartIngestInput)
def start_ingest(ctx: SidecarContext, params: StartIngestInput) -> dict[str, Any]:
    vault, _repository = ctx.require_vault()
    source = params.source.strip()
    if not source:
        raise SidecarError("unsupported_source", "A source is required.")
    if params.subject_id not in vault.subjects:
        raise SidecarError("unknown_subject", f"Subject '{params.subject_id}' does not exist.")
    try:
        resolve_source(source)
    except UnsupportedSourceError as exc:
        raise SidecarError("unsupported_source", str(exc)) from exc
    try:
        job = ctx.ingest_jobs.start(vault.root, source, params.subject_id, params.mode)
    except ActiveIngestJobError as exc:
        raise SidecarError(
            "ingest_in_progress",
            str(exc),
            retryable=True,
            details={"jobId": exc.job_id},
        ) from exc
    return versioned(job)


@method("get_ingest_job", IngestJobInput)
def get_ingest_job(ctx: SidecarContext, params: IngestJobInput) -> dict[str, Any]:
    job = ctx.ingest_jobs.get(params.job_id)
    if job is None:
        raise SidecarError("ingest_job_not_found", f"Ingest job '{params.job_id}' was not found.")
    _reload_completed_jobs(ctx, [job])
    return versioned(ctx.ingest_jobs.get(params.job_id) or job)


@method("get_ingest_jobs")
def get_ingest_jobs(ctx: SidecarContext, _params) -> dict[str, Any]:
    jobs = ctx.ingest_jobs.list()
    _reload_completed_jobs(ctx, jobs)
    return versioned({"jobs": ctx.ingest_jobs.list()})


@method("cancel_ingest", IngestJobInput)
def cancel_ingest(ctx: SidecarContext, params: IngestJobInput) -> dict[str, Any]:
    job = ctx.ingest_jobs.cancel(params.job_id)
    if job is None:
        raise SidecarError("ingest_job_not_found", f"Ingest job '{params.job_id}' was not found.")
    return versioned(job)


def _reload_completed_jobs(ctx: SidecarContext, jobs: list[dict[str, Any]]) -> None:
    completed = [job["id"] for job in jobs if ctx.ingest_jobs.needs_reload(job["id"])]
    if not completed:
        return
    ctx.reload(maintenance=False)
    for job_id in completed:
        ctx.ingest_jobs.mark_reloaded(job_id)


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
