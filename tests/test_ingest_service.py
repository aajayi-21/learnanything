from __future__ import annotations

from learnloop.ingest.models import FetchedSource
from learnloop.services.ingest import ingest_source
from learnloop.services.proposals import build_authoring_context
from learnloop.vault.loader import load_vault
from learnloop.vault.paths import VaultPaths
from learnloop.vault.yaml_io import read_markdown_with_frontmatter

from tests.helpers import create_basic_vault


def _write_source(tmp_path, name="svd.md", body="# SVD Overview\n\nSVD factorizes a matrix into U, Sigma, V^T.\n"):
    path = tmp_path / name
    path.write_text(body, encoding="utf-8")
    return path


def test_ingest_textfile_creates_canonical_source_note(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    source = _write_source(tmp_path)

    result = ingest_source(vault_root, str(source), subject="linear-algebra")

    assert result.kind == "textfile"
    assert result.subject == "linear-algebra"
    assert result.subject_created is False
    assert result.note_id.startswith("note_")
    assert result.source_ref["ref_type"] == "canonical_source"
    assert result.source_ref["ref_id"] == result.note_id

    loaded = load_vault(vault_root)
    note = loaded.notes[result.note_id]
    assert note.source_type == "canonical_source"
    assert "factorizes" in note.body

    paths = VaultPaths(loaded.root, loaded.config)
    metadata, _ = read_markdown_with_frontmatter(paths.note_path("linear-algebra", result.note_id))
    assert metadata["source_type"] == "canonical_source"
    assert metadata["ingest"]["kind"] == "textfile"
    assert metadata["ingest"]["content_hash"] == result.content_hash
    assert metadata["ingest"]["char_count"] == result.char_count


def test_ingested_note_enters_authoring_context(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    source = _write_source(tmp_path)

    result = ingest_source(vault_root, str(source), subject="linear-algebra")
    loaded = load_vault(vault_root)

    context = build_authoring_context(loaded, subjects=["linear-algebra"])
    note_ids = [note["id"] for note in context.notes]
    assert result.note_id in note_ids
    assert result.note_id in context.source_ids


def test_ingest_auto_creates_missing_subject(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    source = _write_source(tmp_path)

    result = ingest_source(vault_root, str(source), subject="Real Analysis")

    assert result.subject == "real-analysis"
    assert result.subject_created is True
    loaded = load_vault(vault_root)
    assert "real-analysis" in loaded.subjects
    assert result.note_id in loaded.notes


def test_ingest_with_injected_fetcher_records_url_and_authors(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)

    def fake_fetcher(source: str) -> FetchedSource:
        return FetchedSource(
            kind="web",
            title="Web Article",
            text_md="# Web Article\n\nReadable body.",
            canonical_url="https://example.com/article",
            locator="https://example.com/article",
            authors=("Jane Doe",),
            extra={"fulltext_available": True},
        )

    result = ingest_source(
        vault_root, "https://example.com/article", subject="linear-algebra", fetcher=fake_fetcher
    )

    assert result.kind == "web"
    assert result.canonical_url == "https://example.com/article"
    assert result.authors == ("Jane Doe",)

    loaded = load_vault(vault_root)
    paths = VaultPaths(loaded.root, loaded.config)
    metadata, body = read_markdown_with_frontmatter(paths.note_path("linear-algebra", result.note_id))
    assert metadata["ingest"]["canonical_url"] == "https://example.com/article"
    assert metadata["ingest"]["authors"] == ["Jane Doe"]
    assert metadata["ingest"]["fulltext_available"] is True
    # Body already starts with an H1, so no duplicate heading is prepended.
    assert body.strip().count("# Web Article") == 1


def test_ingest_twice_produces_unique_note_ids(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    source = _write_source(tmp_path)

    first = ingest_source(vault_root, str(source), subject="linear-algebra")
    second = ingest_source(vault_root, str(source), subject="linear-algebra")

    assert first.note_id != second.note_id
    loaded = load_vault(vault_root)
    assert first.note_id in loaded.notes
    assert second.note_id in loaded.notes
