"""Sidecar contract for Registry review (spec_source_ingestion_v2 §5.7)."""

from __future__ import annotations

import io
import json

from learnloop_sidecar.server import serve

from tests.helpers import create_basic_vault


def _rpc(messages: list[dict]) -> list[dict]:
    stdin = io.StringIO("".join(json.dumps(m) + "\n" for m in messages))
    stdout = io.StringIO()
    serve(stdin, stdout)
    return [json.loads(line) for line in stdout.getvalue().splitlines()]


def test_get_subject_registry_registered(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    results = _rpc(
        [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"vaultPath": str(vault_root)}},
            {"jsonrpc": "2.0", "id": 2, "method": "get_subject_registry",
             "params": {"subjectId": "linear-algebra"}},
        ]
    )
    init = results[0]["result"]
    assert "get_subject_registry" in init["capabilities"]["methods"]
    assert "propose_facet_merge" in init["capabilities"]["methods"]
    registry = results[1]["result"]
    assert registry["subjectId"] == "linear-algebra"
    assert "facets" in registry
    assert "identifiabilityWarnings" in registry


def test_get_subject_registry_unknown_subject(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    results = _rpc(
        [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"vaultPath": str(vault_root)}},
            {"jsonrpc": "2.0", "id": 2, "method": "get_subject_registry",
             "params": {"subjectId": "nope"}},
        ]
    )
    assert results[1]["error"]["data"]["code"] == "unknown_subject"


def test_propose_facet_merge_unknown_facet_typed_error(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    results = _rpc(
        [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"vaultPath": str(vault_root)}},
            {"jsonrpc": "2.0", "id": 2, "method": "propose_facet_merge",
             "params": {"subjectId": "linear-algebra",
                        "retiredFacetId": "facet_a", "survivingFacetId": "facet_b"}},
        ]
    )
    assert results[1]["error"]["data"]["code"] == "facet_not_found"
