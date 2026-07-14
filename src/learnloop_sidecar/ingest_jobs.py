from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
_ACTIVE_STATUSES = {"queued", "running"}
_PROGRESS_KEY = "learnloop_ingest_progress"
_MAX_JOBS = 30


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass
class IngestJob:
    id: str
    vault_root: Path
    source: str
    subject_id: str
    mode: Literal["canonical", "exam"]
    status: JobStatus = "queued"
    phase: str = "queued"
    message: str = "Waiting to start"
    current_window: int | None = None
    total_windows: int | None = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    started_at: str | None = None
    finished_at: str | None = None
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    cancel_requested: bool = False
    process: subprocess.Popen[str] | None = field(default=None, repr=False)
    vault_reloaded: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "subject_id": self.subject_id,
            "mode": self.mode,
            "status": self.status,
            "phase": self.phase,
            "message": self.message,
            "current_window": self.current_window,
            "total_windows": self.total_windows,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result": self.result,
            "error": self.error,
        }


class ActiveIngestJobError(RuntimeError):
    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        super().__init__(f"Ingest job {job_id} is already running.")


class IngestJobManager:
    """Runs the existing canonical CLI in a cancellable background process."""

    def __init__(self) -> None:
        self._jobs: dict[str, IngestJob] = {}
        self._lock = threading.RLock()

    def start(self, vault_root: Path, source: str, subject_id: str, mode: Literal["canonical", "exam"]) -> dict[str, Any]:
        with self._lock:
            active = next((job for job in self._jobs.values() if job.status in _ACTIVE_STATUSES), None)
            if active is not None:
                raise ActiveIngestJobError(active.id)
            job = IngestJob(
                id="ingest_" + uuid.uuid4().hex,
                vault_root=vault_root,
                source=source,
                subject_id=subject_id,
                mode=mode,
            )
            self._jobs[job.id] = job
            self._trim_locked()
        threading.Thread(target=self._run_guarded, args=(job.id,), name=f"learnloop-{job.id}", daemon=True).start()
        return job.as_dict()

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.as_dict() if job is not None else None

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            jobs = sorted(self._jobs.values(), key=lambda job: job.created_at, reverse=True)
            return [job.as_dict() for job in jobs]

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        process: subprocess.Popen[str] | None = None
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            if job.status not in _ACTIVE_STATUSES:
                return job.as_dict()
            job.cancel_requested = True
            job.phase = "cancelling"
            job.message = "Stopping ingestion"
            job.updated_at = _now()
            process = job.process
            snapshot = job.as_dict()
        if process is not None:
            threading.Thread(target=_terminate_process, args=(process,), name=f"cancel-{job_id}", daemon=True).start()
        return snapshot

    def needs_reload(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            return bool(job and job.status == "completed" and not job.vault_reloaded)

    def mark_reloaded(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.vault_reloaded = True

    def shutdown(self) -> None:
        with self._lock:
            active = [job for job in self._jobs.values() if job.status in _ACTIVE_STATUSES]
            for job in active:
                job.cancel_requested = True
                job.phase = "cancelling"
                job.message = "Stopping ingestion"
                job.updated_at = _now()
            processes = [job.process for job in active if job.process is not None]
        for process in processes:
            _terminate_process(process)

    def _run(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs[job_id]
            if job.cancel_requested:
                self._finish_cancelled_locked(job)
                return
            job.status = "running"
            job.phase = "preparing"
            job.message = "Checking the authoring provider"
            job.started_at = _now()
            job.updated_at = job.started_at

        command = "ingest-exam" if job.mode == "exam" else "ingest"
        argv = [
            sys.executable,
            "-m",
            "learnloop",
            command,
            "--subject",
            job.subject_id,
            "--json",
            "--progress-json",
            "--vault",
            str(job.vault_root),
            "--",
            job.source,
        ]
        env = os.environ.copy()
        env.setdefault("PYTHONIOENCODING", "utf-8")
        source_root = str(Path(__file__).resolve().parents[1])
        existing_pythonpath = env.get("PYTHONPATH")
        env["PYTHONPATH"] = source_root if not existing_pythonpath else source_root + os.pathsep + existing_pythonpath
        try:
            process = subprocess.Popen(
                argv,
                cwd=str(job.vault_root),
                env=env,
                text=True,
                encoding="utf-8",
                errors="replace",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=1,
                start_new_session=os.name != "nt",
            )
        except OSError as exc:
            with self._lock:
                self._finish_failed_locked(job, "ingest_spawn_failed", f"Could not start ingestion: {exc}")
            return

        with self._lock:
            job.process = process
            cancel_now = job.cancel_requested
        if cancel_now:
            _terminate_process(process)

        stderr_lines: list[str] = []
        assert process.stderr is not None
        for line in process.stderr:
            if not self._apply_progress(job_id, line):
                stderr_lines.append(line)
        assert process.stdout is not None
        stdout = process.stdout.read()
        return_code = process.wait()

        with self._lock:
            job = self._jobs[job_id]
            job.process = None
            if job.cancel_requested:
                self._finish_cancelled_locked(job)
                return
            payload = _parse_json_document(stdout)
            if return_code == 0 and isinstance(payload.get("ingest"), dict):
                job.status = "completed"
                job.phase = "completed"
                job.message = "Ingest complete"
                job.result = payload["ingest"]
                job.error = None
                job.finished_at = _now()
                job.updated_at = job.finished_at
                return

            raw_code = str(payload.get("error") or "ingest_failed")
            message = str(payload.get("message") or "".join(stderr_lines).strip() or stdout.strip() or f"Ingest failed (exit {return_code}).")
            code = _typed_error_code(raw_code, job.phase)
            partial = job.phase in {"staging", "authoring"}
            self._finish_failed_locked(job, code, message, details={"partial": partial, "exit_code": return_code})

    def _run_guarded(self, job_id: str) -> None:
        try:
            self._run(job_id)
        except Exception as exc:
            process: subprocess.Popen[str] | None = None
            with self._lock:
                job = self._jobs.get(job_id)
                if job is None or job.status not in _ACTIVE_STATUSES:
                    return
                process = job.process
                self._finish_failed_locked(job, "ingest_job_failed", f"Background ingest failed: {exc}")
                job.process = None
            if process is not None:
                _terminate_process(process)

    def _apply_progress(self, job_id: str, line: str) -> bool:
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            return False
        event = payload.get(_PROGRESS_KEY) if isinstance(payload, dict) else None
        if not isinstance(event, dict) or not isinstance(event.get("phase"), str):
            return False
        phase = event["phase"]
        with self._lock:
            job = self._jobs[job_id]
            if job.cancel_requested:
                return True
            job.phase = phase
            job.message = _phase_message(phase)
            job.current_window = _optional_int(event.get("current_window"))
            job.total_windows = _optional_int(event.get("total_windows"))
            job.updated_at = _now()
        return True

    def _finish_failed_locked(
        self,
        job: IngestJob,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        job.status = "failed"
        job.phase = "failed"
        job.message = "Ingest failed"
        job.error = {"code": code, "message": message, "details": details or {}}
        job.finished_at = _now()
        job.updated_at = job.finished_at

    def _finish_cancelled_locked(self, job: IngestJob) -> None:
        job.status = "cancelled"
        job.phase = "cancelled"
        job.message = "Ingest cancelled"
        job.error = {"code": "cancelled", "message": "The ingest was cancelled.", "details": {}}
        job.finished_at = _now()
        job.updated_at = job.finished_at

    def _trim_locked(self) -> None:
        if len(self._jobs) <= _MAX_JOBS:
            return
        removable = sorted(
            (job for job in self._jobs.values() if job.status not in _ACTIVE_STATUSES),
            key=lambda job: job.created_at,
        )
        for job in removable[: max(0, len(self._jobs) - _MAX_JOBS)]:
            self._jobs.pop(job.id, None)


def _parse_json_document(stdout: str) -> dict[str, Any]:
    try:
        payload = json.loads(stdout.strip())
    except (json.JSONDecodeError, TypeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _optional_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def _typed_error_code(raw_code: str, phase: str) -> str:
    if raw_code != "ingest_failed":
        return raw_code
    if phase == "fetching":
        return "fetch_failed"
    if phase == "extracting":
        return "extraction_failed"
    if phase in {"staging", "authoring"}:
        return "authoring_failed"
    return raw_code


def _phase_message(phase: str) -> str:
    return {
        "preparing": "Checking the authoring provider",
        "fetching": "Fetching source material",
        "extracting": "Extracting clean Markdown",
        "staging": "Staging the canonical-source note",
        "authoring": "Generating the authoring proposal",
    }.get(phase, phase.replace("_", " ").capitalize())


def _terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name != "nt":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        process.wait(timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        try:
            if os.name != "nt":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except OSError:
            pass
