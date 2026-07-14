from __future__ import annotations

import io
import json
import threading
import time

import pytest

from learnloop_sidecar.ingest_jobs import ActiveIngestJobError, IngestJob, IngestJobManager


class _CompletedProcess:
    def __init__(self, *_args, **_kwargs) -> None:
        self.pid = 999_999
        self.stderr = io.StringIO(
            json.dumps(
                {
                    "learnloop_ingest_progress": {
                        "phase": "authoring",
                        "current_window": 2,
                        "total_windows": 3,
                    }
                }
            )
            + "\n"
        )
        self.stdout = io.StringIO(
            json.dumps(
                {
                    "version": 1,
                    "ingest": {
                        "proposal_id": "patch_test",
                        "source_note_id": "note_test",
                        "source_kind": "website_page",
                        "subject_id": "linear-algebra",
                        "reused_existing": False,
                        "auto_applied_count": 1,
                        "review_required_count": 2,
                        "invalid_count": 0,
                    },
                },
                indent=2,
            )
        )

    def wait(self, timeout=None) -> int:
        return 0

    def poll(self):
        return 0


def _wait_for_terminal(manager: IngestJobManager, job_id: str) -> dict:
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        job = manager.get(job_id)
        assert job is not None
        if job["status"] not in {"queued", "running"}:
            return job
        time.sleep(0.01)
    raise AssertionError("ingest job did not finish")


def test_background_ingest_job_parses_pretty_json(monkeypatch, tmp_path):
    monkeypatch.setattr("learnloop_sidecar.ingest_jobs.subprocess.Popen", _CompletedProcess)
    manager = IngestJobManager()

    started = manager.start(tmp_path, "notes.md", "linear-algebra", "canonical")
    finished = _wait_for_terminal(manager, started["id"])

    assert finished["status"] == "completed"
    assert finished["phase"] == "completed"
    assert finished["result"]["proposal_id"] == "patch_test"
    assert manager.needs_reload(started["id"]) is True
    manager.mark_reloaded(started["id"])
    assert manager.needs_reload(started["id"]) is False


def test_progress_event_updates_window_counts(tmp_path):
    manager = IngestJobManager()
    job = IngestJob(
        id="ingest_test",
        vault_root=tmp_path,
        source="notes.md",
        subject_id="linear-algebra",
        mode="canonical",
        status="running",
    )
    manager._jobs[job.id] = job

    consumed = manager._apply_progress(
        job.id,
        '{"learnloop_ingest_progress":{"phase":"authoring","current_window":2,"total_windows":4}}',
    )

    assert consumed is True
    snapshot = manager.get(job.id)
    assert snapshot is not None
    assert snapshot["phase"] == "authoring"
    assert snapshot["current_window"] == 2
    assert snapshot["total_windows"] == 4


def test_job_failure_is_typed_from_the_last_pipeline_phase(monkeypatch, tmp_path):
    class _FailedProcess(_CompletedProcess):
        def __init__(self, *_args, **_kwargs) -> None:
            self.pid = 999_997
            self.stderr = io.StringIO(
                '{"learnloop_ingest_progress":{"phase":"fetching"}}\n'
            )
            self.stdout = io.StringIO(
                json.dumps({"version": 1, "error": "ingest_failed", "message": "network unavailable"}, indent=2)
            )

        def wait(self, timeout=None) -> int:
            return 1

        def poll(self):
            return 1

    monkeypatch.setattr("learnloop_sidecar.ingest_jobs.subprocess.Popen", _FailedProcess)
    manager = IngestJobManager()

    started = manager.start(tmp_path, "https://example.invalid", "linear-algebra", "canonical")
    finished = _wait_for_terminal(manager, started["id"])

    assert finished["status"] == "failed"
    assert finished["error"]["code"] == "fetch_failed"
    assert finished["error"]["message"] == "network unavailable"
    assert finished["error"]["details"]["partial"] is False


def test_only_one_ingest_can_write_a_vault_at_once(tmp_path):
    manager = IngestJobManager()
    manager._jobs["ingest_active"] = IngestJob(
        id="ingest_active",
        vault_root=tmp_path,
        source="notes.md",
        subject_id="linear-algebra",
        mode="canonical",
        status="running",
    )

    with pytest.raises(ActiveIngestJobError) as excinfo:
        manager.start(tmp_path, "other.md", "linear-algebra", "canonical")

    assert excinfo.value.job_id == "ingest_active"


def test_cancelled_job_reaches_terminal_state(monkeypatch, tmp_path):
    release = threading.Event()

    class _BlockingStream:
        def __iter__(self):
            release.wait(timeout=2)
            return iter(())

    class _BlockingProcess:
        def __init__(self, *_args, **_kwargs) -> None:
            self.pid = 999_998
            self.stderr = _BlockingStream()
            self.stdout = io.StringIO("")

        def wait(self, timeout=None) -> int:
            release.wait(timeout=2)
            return -15

        def poll(self):
            return None if not release.is_set() else -15

    def _terminate(_process) -> None:
        release.set()

    monkeypatch.setattr("learnloop_sidecar.ingest_jobs.subprocess.Popen", _BlockingProcess)
    monkeypatch.setattr("learnloop_sidecar.ingest_jobs._terminate_process", _terminate)
    manager = IngestJobManager()
    started = manager.start(tmp_path, "notes.md", "linear-algebra", "canonical")

    deadline = time.monotonic() + 2
    while manager.get(started["id"])["status"] == "queued" and time.monotonic() < deadline:
        time.sleep(0.01)
    manager.cancel(started["id"])
    finished = _wait_for_terminal(manager, started["id"])

    assert finished["status"] == "cancelled"
    assert finished["error"]["code"] == "cancelled"
