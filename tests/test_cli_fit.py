"""`learnloop fit` CLI: refusal below min reviews, show/deactivate round-trip."""

from __future__ import annotations

import json

from typer.testing import CliRunner

from learnloop.cli import app
from learnloop.db.repositories import Repository

from tests.helpers import create_basic_vault

runner = CliRunner()


def test_fit_fsrs_refuses_on_empty_vault(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    result = runner.invoke(app, ["fit", "fsrs", "--vault", str(vault_root), "--json", "--dry-run"])
    assert result.exit_code == 1, result.output
    payload = json.loads(result.output)
    assert payload["error"] == "insufficient_reviews"


def test_fit_show_and_deactivate_round_trip(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    repository = Repository(paths.sqlite_path)
    repository.insert_fitted_parameters(
        scope="fsrs_weights",
        params={"weights": [1.0]},
        algorithm_version="mvp-0.3",
        training_rows_count=100,
        metrics={"log_loss_fitted": 0.4},
    )

    shown = runner.invoke(app, ["fit", "show", "--vault", str(vault_root), "--json"])
    assert shown.exit_code == 0, shown.output
    rows = json.loads(shown.output)["fitted_parameters"]
    assert len(rows) == 1
    assert rows[0]["scope"] == "fsrs_weights"
    assert rows[0]["active"] is True

    deactivated = runner.invoke(app, ["fit", "deactivate", "fsrs_weights", "--vault", str(vault_root), "--json"])
    assert deactivated.exit_code == 0, deactivated.output
    assert json.loads(deactivated.output)["deactivated"] == 1
    assert repository.active_fitted_parameters("fsrs_weights") is None
