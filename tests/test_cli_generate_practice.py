from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from typer.testing import CliRunner

from learnloop.cli import app
from learnloop.clock import FrozenClock
from learnloop.db.repositories import MasteryState, Repository
from learnloop.services.proposals import queue_accepted_diagnostic_followups
from learnloop.services.scheduler import build_due_queue
from learnloop.vault.loader import load_vault

from tests.helpers import ALGORITHM_VERSION, NOW, NOW_ISO, create_basic_vault


def test_generate_practice_dry_run_targets_completed_probe(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    _complete_probe(paths.sqlite_path)
    runner = CliRunner()

    result = runner.invoke(
        app,
        [
            "generate-practice",
            "--vault",
            str(vault_root),
            "--target-items-per-lo",
            "4",
            "--max-new-per-lo",
            "2",
            "--dry-run",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["plan"]["requested_new_items"] == 2
    target = payload["plan"]["targets"][0]
    assert target["learning_object_id"] == "lo_svd_definition"
    assert target["existing_practice_items"] == 1
    assert target["requested_new_items"] == 2


def test_generate_practice_reports_no_targets_before_probe_completion(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    runner = CliRunner()

    result = runner.invoke(app, ["generate-practice", "--vault", str(vault_root), "--json"])

    assert result.exit_code == 1
    assert json.loads(result.output)["error"] == "no_targets"


def test_generate_diagnostics_dry_run_targets_pending_intervention_need(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    repository = Repository(paths.sqlite_path)
    need_id = _seed_diagnostic_need(repository)
    runner = CliRunner()

    result = runner.invoke(
        app,
        [
            "generate-diagnostics",
            "--vault",
            str(vault_root),
            "--dry-run",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["plan"]["requested_new_items"] == 1
    target = payload["plan"]["targets"][0]
    assert target["need_id"] == need_id
    assert target["learning_object_id"] == "lo_svd_definition"
    assert target["target_facets"] == ["recall"]
    assert target["source_practice_item_id"] == "pi_svd_define_001"
    assert target["source_prompt"] == "Define SVD."
    assert target["candidate_requirements"] == {"avoid_practice_item_ids": ["pi_svd_define_001"]}
    # No facet/mastery evidence -> ability 0.5 -> probe sits on the boundary (~50% success).
    assert target["recommended_difficulty_band"] == [0.46, 0.54]


def test_generate_diagnostics_reports_no_pending_needs(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    runner = CliRunner()

    result = runner.invoke(app, ["generate-diagnostics", "--vault", str(vault_root), "--json"])

    assert result.exit_code == 1
    assert json.loads(result.output)["error"] == "no_targets"


def test_generate_practice_runs_codex_http_and_persists_proposal(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    _complete_probe(paths.sqlite_path)
    checkout = tmp_path / "codex"
    checkout.mkdir()
    (checkout / "HEAD").write_text("abc123", encoding="utf-8")
    server = _ProposalServer(_practice_proposal_payload())
    server.start()
    try:
        _configure_codex(vault_root, checkout, server.base_url)
        runner = CliRunner()
        result = runner.invoke(
            app,
            [
                "generate-practice",
                "--vault",
                str(vault_root),
                "--target-items-per-lo",
                "3",
                "--max-new-per-lo",
                "2",
                "--json",
            ],
        )
    finally:
        server.stop()

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["proposal_id"]
    assert payload["plan"]["requested_new_items"] == 2
    assert server.requests[0]["path"] == "/authoring-proposal"
    instructions = server.requests[0]["body"]["context"]["instructions"]
    assert "lo_svd_definition" in instructions
    assert "Create only practice_item proposal items" in instructions


def test_generate_diagnostics_runs_codex_http_and_marks_need_fulfilled(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    repository = Repository(paths.sqlite_path)
    need_id = _seed_diagnostic_need(repository)
    checkout = tmp_path / "codex"
    checkout.mkdir()
    (checkout / "HEAD").write_text("abc123", encoding="utf-8")
    server = _ProposalServer(_diagnostic_proposal_payload())
    server.start()
    try:
        _configure_codex(vault_root, checkout, server.base_url)
        runner = CliRunner()
        result = runner.invoke(
            app,
            [
                "generate-diagnostics",
                "--vault",
                str(vault_root),
                "--json",
            ],
        )
    finally:
        server.stop()

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["proposal_id"]
    assert payload["fulfilled_need_ids"] == [need_id]
    assert payload["plan"]["requested_new_items"] == 1
    assert server.requests[0]["path"] == "/authoring-proposal"
    instructions = server.requests[0]["body"]["context"]["instructions"]
    assert "Generate diagnostic LearnLoop Practice Items" in instructions
    assert "diagnostic_probe" in instructions
    assert need_id in instructions
    assert "target_facets" in instructions
    assert "avoid_practice_item_ids" in instructions
    assert repository.pending_intervention_needs("lo_svd_definition") == []
    with repository.connection() as connection:
        status = connection.execute(
            "SELECT status, blocked_reason FROM intervention_needs WHERE id = ?",
            (need_id,),
        ).fetchone()
    assert status["status"] == "fulfilled"
    assert status["blocked_reason"].startswith("diagnostic_proposal_queued:")


def test_accepting_diagnostic_proposal_queues_today_followup(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    repository = Repository(paths.sqlite_path)
    need_id = _seed_diagnostic_need(repository)
    _seed_diagnostic_surprise(repository, need_id)
    checkout = tmp_path / "codex"
    checkout.mkdir()
    (checkout / "HEAD").write_text("abc123", encoding="utf-8")
    server = _ProposalServer(_diagnostic_proposal_payload())
    server.start()
    try:
        _configure_codex(vault_root, checkout, server.base_url)
        runner = CliRunner()
        generated = runner.invoke(
            app,
            [
                "generate-diagnostics",
                "--vault",
                str(vault_root),
                "--json",
            ],
        )
    finally:
        server.stop()

    assert generated.exit_code == 0, generated.output
    patch_id = json.loads(generated.output)["proposal_id"]

    accepted = runner.invoke(app, ["accept", patch_id, "--vault", str(vault_root)])

    assert accepted.exit_code == 0, accepted.output
    surprise = repository.latest_attempt_surprise("attempt_svd_recall_gap")
    assert "intervention_followup:queued:pi_svd_recall_diagnostic_001" in surprise["triggered_actions"]
    repository.update_attempt_surprise_actions(
        "attempt_svd_recall_gap",
        triggered_actions=["intervention_followup:severe_error_event:pi_svd_define_001"],
    )
    assert queue_accepted_diagnostic_followups(repository) == 1
    assert queue_accepted_diagnostic_followups(repository) == 0
    queue = build_due_queue(load_vault(vault_root), repository, clock=FrozenClock(NOW), persist_explanations=False)
    assert queue[0].practice_item_id == "pi_svd_recall_diagnostic_001"
    assert queue[0].components["intervention_followup"] == 1.0


def test_rejecting_review_required_diagnostic_reopens_need_for_regeneration(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    repository = Repository(paths.sqlite_path)
    need_id = _seed_diagnostic_need(repository)
    checkout = tmp_path / "codex"
    checkout.mkdir()
    (checkout / "HEAD").write_text("abc123", encoding="utf-8")
    server = _ProposalServer(_diagnostic_proposal_payload())
    server.start()
    try:
        _configure_codex(vault_root, checkout, server.base_url)
        runner = CliRunner()
        generated = runner.invoke(
            app,
            [
                "generate-diagnostics",
                "--vault",
                str(vault_root),
                "--json",
            ],
        )
    finally:
        server.stop()

    assert generated.exit_code == 0, generated.output
    patch_id = json.loads(generated.output)["proposal_id"]
    item = repository.proposal_items(patch_id)[0]

    rejected = runner.invoke(app, ["reject", patch_id, "--vault", str(vault_root)])

    assert rejected.exit_code == 0, rejected.output
    with repository.connection() as connection:
        status = connection.execute(
            "SELECT status, blocked_reason FROM intervention_needs WHERE id = ?",
            (need_id,),
        ).fetchone()
    assert status["status"] == "pending"
    assert status["blocked_reason"] == f"diagnostic_proposal_rejected:{patch_id}:{item['id']}"

    dry_run = runner.invoke(
        app,
        [
            "generate-diagnostics",
            "--vault",
            str(vault_root),
            "--dry-run",
            "--json",
        ],
    )
    assert dry_run.exit_code == 0, dry_run.output
    target = json.loads(dry_run.output)["plan"]["targets"][0]
    assert target["need_id"] == need_id


def test_generate_diagnostics_resolves_diagnostic_need_source_refs(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    repository = Repository(paths.sqlite_path)
    need_id = _seed_diagnostic_need(repository)
    proposal = _diagnostic_proposal_payload()
    proposal["source_refs"] = [{"ref_type": "existing_entity", "ref_id": need_id}]
    proposal["items"][0]["source_ref_ids"] = [need_id]
    checkout = tmp_path / "codex"
    checkout.mkdir()
    (checkout / "HEAD").write_text("abc123", encoding="utf-8")
    server = _ProposalServer(proposal)
    server.start()
    try:
        _configure_codex(vault_root, checkout, server.base_url)
        runner = CliRunner()
        result = runner.invoke(
            app,
            [
                "generate-diagnostics",
                "--vault",
                str(vault_root),
                "--json",
            ],
        )
    finally:
        server.stop()

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    item = repository.proposal_items(payload["proposal_id"])[0]
    assert item["source_ref_ids"] == [need_id]
    assert item["validation_status"] == "valid"
    assert not any(error.startswith("unresolved_source_ref:") for error in item["validation_errors"])
    batch = repository.proposal_batch(payload["proposal_id"])
    assert _has_source_ref(batch["source_refs"], "manual_context", need_id)
    assert _has_source_ref(batch["source_refs"], "existing_entity", "lo_svd_definition")
    assert {"ref_type": "manual_context", "ref_id": need_id} in server.requests[0]["body"]["context"]["source_refs"]


def _has_source_ref(refs: list[dict], ref_type: str, ref_id: str) -> bool:
    return any(ref.get("ref_type") == ref_type and ref.get("ref_id") == ref_id for ref in refs)


def _complete_probe(sqlite_path) -> None:
    repository = Repository(sqlite_path)
    repository.upsert_mastery_state(
        MasteryState(
            learning_object_id="lo_svd_definition",
            logit_mean=0.0,
            logit_variance=0.5,
            evidence_count=3,
            last_evidence_at=NOW_ISO,
            algorithm_version="mvp-0.1",
            updated_at=NOW_ISO,
        )
    )
    repository.upsert_probe_state(
        learning_object_id="lo_svd_definition",
        status="complete",
        algorithm_version="mvp-0.1",
        probe_phase_id="probe_lo_svd_definition",
        hypothesis_set_id="hypotheses_lo_svd_definition",
        probe_attempts_completed=3,
        probe_attempts_target=3,
        completed_at=NOW_ISO,
        clock=FrozenClock(NOW),
    )


def _seed_diagnostic_need(repository: Repository, *, need_id: str = "need_svd_recall") -> str:
    return repository.upsert_intervention_need(
        {
            "id": need_id,
            "attempt_id": "attempt_svd_recall_gap",
            "learning_object_id": "lo_svd_definition",
            "practice_item_id": "pi_svd_define_001",
            "desired_intent": "probe",
            "trigger_reason": "severe_error_event",
            "target_facets": ["recall"],
            "error_types": ["recall_failure"],
            "priority": 0.95,
            "status": "pending",
            "blocked_reason": "no_suitable_item",
            "candidate_requirements": {"avoid_practice_item_ids": ["pi_svd_define_001"]},
            "created_at": NOW_ISO,
            "updated_at": NOW_ISO,
        }
    )


def _seed_diagnostic_surprise(repository: Repository, need_id: str) -> None:
    repository.insert_practice_attempt(
        {
            "id": "attempt_svd_recall_gap",
            "practice_item_id": "pi_svd_define_001",
            "learning_object_id": "lo_svd_definition",
            "subject": "linear-algebra",
            "concept": "singular_value_decomposition",
            "practice_mode": "short_answer",
            "attempt_type": "independent_attempt",
            "learner_answer_md": "I do not remember.",
            "evidence_facets": ["recall"],
            "evidence_weights": {"recall": 1.0},
            "rubric_score": 0,
            "correctness": 0.0,
            "confidence": 4,
            "latency_seconds": 10,
            "hints_used": 0,
            "error_type": "conceptual_slip",
            "grader_confidence": 1.0,
            "created_at": NOW_ISO,
            "updated_at": NOW_ISO,
        }
    )
    repository.insert_attempt_surprise(
        {
            "attempt_id": "attempt_svd_recall_gap",
            "predicted_score_dist": {"expected_correctness": 0.8},
            "predicted_error_type_dist": {},
            "observed_joint_bucket": {"score_bucket": "low", "error_type": "recall_failure"},
            "predictive_surprise": 1.0,
            "bayesian_surprise": 2.0,
            "surprise_direction": "negative",
            "fsrs_interval_factor": 0.5,
            "posterior_delta": {},
            "triggered_actions": ["intervention_followup:severe_error_event:pi_svd_define_001"],
            "suppressed_actions": [f"intervention_followup:no_suitable_item:{need_id}"],
            "algorithm_version": ALGORITHM_VERSION,
            "created_at": NOW_ISO,
        }
    )


def _practice_proposal_payload() -> dict:
    return {
        "summary": "More practice for completed probes",
        "source_refs": [{"ref_type": "existing_entity", "ref_id": "lo_svd_definition"}],
        "items": [
            {
                "client_item_id": "pi_more_1",
                "item_type": "practice_item",
                "operation": "create",
                "proposed_entity_id": "pi_svd_more_001",
                "source_ref_ids": ["lo_svd_definition"],
                "rationale": "Add post-probe practice.",
                "review_route": "review_required",
                "payload": {
                    "learning_object_id": "lo_svd_definition",
                    "subjects": None,
                    "practice_mode": "constructed_response",
                    "attempt_types_allowed": ["open_text"],
                    "prompt": "Explain SVD in your own words.",
                    "expected_answer": "SVD factors a matrix into U, Sigma, and V transpose.",
                    "evidence_facets": ["explanation"],
                    "evidence_weights": {"explanation": 1.0},
                    "grading_rubric": {
                        "max_points": 4,
                        "criteria": [{"id": "correctness", "points": 4, "description": "Correct explanation."}],
                        "fatal_errors": [],
                    },
                },
            }
        ],
    }


def _diagnostic_proposal_payload() -> dict:
    return {
        "summary": "Diagnostic probe for an intervention need",
        "source_refs": [{"ref_type": "existing_entity", "ref_id": "lo_svd_definition"}],
        "items": [
            {
                "client_item_id": "diagnostic_need_svd_recall",
                "item_type": "practice_item",
                "operation": "create",
                "proposed_entity_id": "pi_svd_recall_diagnostic_001",
                "source_ref_ids": ["lo_svd_definition"],
                "rationale": "Create a reviewed diagnostic probe for recall of the missing facet.",
                "review_route": "review_required",
                "payload": {
                    "learning_object_id": "lo_svd_definition",
                    "subjects": None,
                    "practice_mode": "diagnostic_probe",
                    "attempt_types_allowed": ["diagnostic_probe", "open_text", "dont_know"],
                    "prompt": "What are the three factors in the SVD of a matrix?",
                    "expected_answer": "U, Sigma, and V transpose.",
                    "difficulty": 0.5,
                    "difficulty_source": "llm_estimate",
                    "retrieval_demand": 0.85,
                    "transfer_distance": 0.15,
                    "scaffold_level": 0.2,
                    "surface_family": "svd_definition_diagnostic",
                    "evidence_facets": ["recall"],
                    "evidence_weights": {"recall": 1.0},
                    "repair_targets": ["recall"],
                    "criterion_facet_weights": {"c_recall": {"recall": 1.0}},
                    "grading_rubric": {
                        "max_points": 4,
                        "criteria": [
                            {
                                "id": "c_recall",
                                "points": 4,
                                "description": "Recalls the factors U, Sigma, and V transpose.",
                            }
                        ],
                        "fatal_errors": [],
                    },
                },
            }
        ],
    }


def _configure_codex(vault_root, checkout, base_url: str) -> None:
    config_path = vault_root / "learnloop.toml"
    text = config_path.read_text(encoding="utf-8")
    text = text.replace('provider = "sdk"', 'provider = "http"')
    text = text.replace('checkout_path = "../codex"', f'checkout_path = "{checkout.as_posix()}"')
    text = text.replace('revision = "<pinned-commit>"', 'revision = "abc123"')
    text = text.replace('base_url = "http://127.0.0.1:8765"', f'base_url = "{base_url}"')
    config_path.write_text(text, encoding="utf-8")


class _ProposalServer:
    def __init__(self, proposal: dict):
        self.proposal = proposal
        self.requests: list[dict] = []
        self._server = HTTPServer(("127.0.0.1", 0), self._handler())
        self.base_url = f"http://127.0.0.1:{self._server.server_port}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._thread.join(timeout=5)
        self._server.server_close()

    def _handler(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                if self.path != "/health":
                    self.send_response(404)
                    self.end_headers()
                    return
                self._json({"status": "ready"})

            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                owner.requests.append({"path": self.path, "body": body})
                if self.path == "/authoring-proposal":
                    self._json(owner.proposal)
                    return
                self.send_response(404)
                self.end_headers()

            def log_message(self, *_args):
                return

            def _json(self, payload: dict) -> None:
                raw = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        return Handler
