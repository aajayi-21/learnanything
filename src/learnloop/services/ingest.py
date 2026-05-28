from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Callable

from learnloop.clock import Clock, utc_now_iso
from learnloop.ids import kebab_case, snake_case
from learnloop.ingest.fetchers import fetch_source
from learnloop.ingest.models import FetchedSource, IngestResult, UnsupportedSourceError
from learnloop.vault.loader import add_subject, load_vault
from learnloop.vault.paths import VaultPaths
from learnloop.vault.yaml_io import write_markdown_with_frontmatter

Fetcher = Callable[[str], FetchedSource]


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _note_id_from_title(title: str) -> str:
    slug = snake_case(title)[:60].strip("_")
    return slug or "source"


def _unique_note_path(paths: VaultPaths, subject: str, note_id: str) -> tuple[str, Path]:
    candidate = note_id
    suffix = 2
    while paths.note_path(subject, candidate).exists():
        candidate = f"{note_id}_{suffix}"
        suffix += 1
    return candidate, paths.note_path(subject, candidate)


def _compose_note_body(title: str, text: str) -> str:
    if text.lstrip().startswith("# "):
        return text if text.endswith("\n") else text + "\n"
    return f"# {title}\n\n{text}\n"


def ingest_source(
    root: Path,
    source: str,
    *,
    subject: str,
    note_id: str | None = None,
    title: str | None = None,
    create_subject: bool = True,
    fetcher: Fetcher | None = None,
    clock: Clock | None = None,
) -> IngestResult:
    """Fetch ``source`` and stage it as a ``canonical_source`` note in ``subject``.

    The fetch step is injectable via ``fetcher`` so the orchestration can be
    tested without network access or the optional extraction libraries. The
    written note flows into the existing authoring-proposal context automatically
    (``build_authoring_context`` reads all notes), and the returned ``source_ref``
    can be cited directly by Codex proposals.
    """

    vault = load_vault(root)
    paths = VaultPaths(vault.root, vault.config)
    normalized_subject = kebab_case(subject)
    if not normalized_subject:
        raise UnsupportedSourceError(f"Invalid subject id {subject!r}")

    subject_created = False
    if normalized_subject not in vault.subjects:
        if not create_subject:
            raise UnsupportedSourceError(
                f"Subject {normalized_subject!r} does not exist. "
                f"Create it first with `learnloop add-subject`, or allow auto-creation."
            )
        add_subject(root, normalized_subject, normalized_subject.replace("-", " ").title(), clock=clock)
        subject_created = True
        vault = load_vault(root)
        paths = VaultPaths(vault.root, vault.config)

    fetched = (fetcher or fetch_source)(source)

    resolved_title = title or fetched.title or source
    base_note_id = "note_" + snake_case((note_id or _note_id_from_title(resolved_title)).removeprefix("note_"))
    final_note_id, note_path = _unique_note_path(paths, normalized_subject, base_note_id)

    text = fetched.text_md
    content_hash = _content_hash(text)
    now = utc_now_iso(clock)
    frontmatter = {
        "schema_version": 1,
        "id": final_note_id,
        "subjects": [normalized_subject],
        "related_los": [],
        "related_concepts": [],
        "source_type": "canonical_source",
        "ingest": {
            "kind": fetched.kind,
            "canonical_url": fetched.canonical_url,
            "locator": fetched.locator,
            "authors": list(fetched.authors),
            "content_hash": content_hash,
            "char_count": len(text),
            "ingested_at": now,
            **fetched.extra,
        },
        "created_at": now,
        "updated_at": now,
    }
    write_markdown_with_frontmatter(note_path, frontmatter, _compose_note_body(resolved_title, text))

    relative_path = note_path.relative_to(vault.root).as_posix()
    source_ref = {
        "ref_type": "canonical_source",
        "ref_id": final_note_id,
        "path": relative_path,
        "locator": fetched.locator or fetched.canonical_url,
    }
    return IngestResult(
        note_id=final_note_id,
        note_path=relative_path,
        subject=normalized_subject,
        kind=fetched.kind,
        title=resolved_title,
        char_count=len(text),
        content_hash=content_hash,
        canonical_url=fetched.canonical_url,
        locator=fetched.locator,
        authors=fetched.authors,
        source_ref=source_ref,
        subject_created=subject_created,
    )
