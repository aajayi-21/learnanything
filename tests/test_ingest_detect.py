from __future__ import annotations

import pytest

from learnloop.ingest.detect import detect_source_kind
from learnloop.ingest.models import UnsupportedSourceError


@pytest.mark.parametrize(
    ("source", "kind"),
    [
        ("https://en.wikipedia.org/wiki/Singular_value_decomposition", "web"),
        ("https://example.com/notes/linear-algebra", "web"),
        ("https://arxiv.org/abs/2310.12345", "arxiv"),
        ("https://arxiv.org/pdf/2310.12345v2", "arxiv"),
        ("https://ar5iv.labs.arxiv.org/html/2310.12345", "arxiv"),
        ("2310.12345", "arxiv"),
        ("arXiv:2310.12345v3", "arxiv"),
        ("math.GT/0309136", "arxiv"),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"),
        ("https://youtu.be/dQw4w9WgXcQ", "youtube"),
        ("https://www.youtube.com/shorts/abcDEF12345", "youtube"),
        ("https://example.com/papers/strang-ch7.pdf", "pdf"),
    ],
)
def test_detect_url_and_id_sources(source, kind):
    assert detect_source_kind(source) == kind


def test_detect_local_files(tmp_path):
    pdf = tmp_path / "chapter.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    md = tmp_path / "notes.md"
    md.write_text("# Notes\n", encoding="utf-8")
    txt = tmp_path / "raw.txt"
    txt.write_text("plain", encoding="utf-8")

    assert detect_source_kind(str(pdf)) == "pdf"
    assert detect_source_kind(str(md)) == "textfile"
    assert detect_source_kind(str(txt)) == "textfile"


def test_detect_extensionless_existing_file_is_text(tmp_path):
    weird = tmp_path / "LICENSE"
    weird.write_text("text", encoding="utf-8")
    assert detect_source_kind(str(weird)) == "textfile"


def test_detect_rejects_unknown_sources():
    with pytest.raises(UnsupportedSourceError):
        detect_source_kind("")
    with pytest.raises(UnsupportedSourceError):
        detect_source_kind("not-a-url-or-file.xyz")
