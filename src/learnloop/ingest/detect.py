from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlparse

from learnloop.ingest.models import UnsupportedSourceError

# arXiv identifiers: new style (2310.12345 / 2310.12345v2) and the legacy
# archive.subject/NNNNNNN form (e.g. math.GT/0309136).
_ARXIV_NEW = re.compile(r"^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$", re.IGNORECASE)
_ARXIV_OLD = re.compile(r"^(arxiv:)?[a-z\-]+(\.[a-z]{2})?/\d{7}(v\d+)?$", re.IGNORECASE)

_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}
_ARXIV_HOST_SUFFIXES = ("arxiv.org",)

_TEXT_SUFFIXES = {".md", ".markdown", ".mdown", ".txt", ".text", ".rst"}


def _is_url(source: str) -> bool:
    return source.lower().startswith(("http://", "https://"))


def _is_arxiv_id(source: str) -> bool:
    return bool(_ARXIV_NEW.match(source) or _ARXIV_OLD.match(source))


def detect_source_kind(source: str) -> str:
    """Classify a source string into one of the supported ingestion kinds.

    Returns one of ``web``, ``arxiv``, ``pdf``, ``youtube``, ``textfile``.
    Raises :class:`UnsupportedSourceError` for anything unrecognized.
    """

    candidate = source.strip()
    if not candidate:
        raise UnsupportedSourceError("empty source")

    if _is_url(candidate):
        parsed = urlparse(candidate)
        host = parsed.netloc.lower().split(":", 1)[0]
        path = parsed.path.lower()
        if host in _YOUTUBE_HOSTS:
            return "youtube"
        if any(host == suffix or host.endswith("." + suffix) for suffix in _ARXIV_HOST_SUFFIXES):
            return "arxiv"
        if path.endswith(".pdf"):
            return "pdf"
        return "web"

    if _is_arxiv_id(candidate):
        return "arxiv"

    path = Path(candidate)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "pdf"
    if suffix in _TEXT_SUFFIXES:
        return "textfile"
    if path.exists() and path.is_file():
        # An extant local file with no recognized extension is treated as text.
        return "textfile"

    raise UnsupportedSourceError(
        f"Could not classify source {source!r}. Pass a URL (web/arXiv/YouTube), "
        f"an arXiv id, or a local .pdf/.md/.txt file path."
    )
