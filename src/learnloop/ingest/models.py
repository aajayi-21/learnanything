from __future__ import annotations

from dataclasses import dataclass, field


class IngestError(RuntimeError):
    """Base class for ingestion failures."""


class UnsupportedSourceError(IngestError):
    """Raised when a source string cannot be classified into a known kind."""


class SourceFetchError(IngestError):
    """Raised when fetching or extracting a recognized source fails."""


class IngestDependencyMissing(IngestError):
    """Raised when the optional library a fetcher needs is not installed."""

    def __init__(self, kind: str, package: str, extra: str = "learnloop[ingest]") -> None:
        self.kind = kind
        self.package = package
        self.extra = extra
        super().__init__(
            f"{kind} ingestion needs the optional dependency '{package}'. "
            f"Install it with: pip install {extra}"
        )


@dataclass(frozen=True)
class FetchedSource:
    """Normalized result of fetching one canonical source.

    ``text_md`` is the cleaned Markdown body that becomes the note content;
    everything else is provenance recorded in the note frontmatter.
    """

    kind: str
    title: str
    text_md: str
    canonical_url: str | None = None
    locator: str | None = None
    authors: tuple[str, ...] = ()
    extra: dict = field(default_factory=dict)


@dataclass(frozen=True)
class IngestResult:
    """Outcome of staging a canonical source into the vault."""

    note_id: str
    note_path: str
    subject: str
    kind: str
    title: str
    char_count: int
    content_hash: str
    canonical_url: str | None
    locator: str | None
    authors: tuple[str, ...]
    source_ref: dict
    subject_created: bool

    def as_dict(self) -> dict:
        return {
            "note_id": self.note_id,
            "note_path": self.note_path,
            "subject": self.subject,
            "kind": self.kind,
            "title": self.title,
            "char_count": self.char_count,
            "content_hash": self.content_hash,
            "canonical_url": self.canonical_url,
            "locator": self.locator,
            "authors": list(self.authors),
            "source_ref": self.source_ref,
            "subject_created": self.subject_created,
        }
