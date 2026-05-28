"""Canonical-source ingestion: fetch and normalize external material into the vault.

The ingester turns a textbook chapter, web page, arXiv paper, or YouTube
transcript into a ``canonical_source`` note that the existing authoring-proposal
pipeline can read. Network-bound extraction libraries are optional (see the
``ingest`` extra in ``pyproject.toml``); importing this package never requires
them, and each fetcher raises :class:`IngestDependencyMissing` with an install
hint if its library is absent.
"""

from learnloop.ingest.detect import detect_source_kind
from learnloop.ingest.fetchers import SUPPORTED_KINDS, fetch_source
from learnloop.ingest.models import (
    FetchedSource,
    IngestDependencyMissing,
    IngestError,
    IngestResult,
    SourceFetchError,
    UnsupportedSourceError,
)

__all__ = [
    "FetchedSource",
    "IngestResult",
    "IngestError",
    "IngestDependencyMissing",
    "SourceFetchError",
    "UnsupportedSourceError",
    "SUPPORTED_KINDS",
    "detect_source_kind",
    "fetch_source",
]
