from __future__ import annotations

from typing import Any

from learnloop.ai.client import make_ai_provider_client
from learnloop.ai.routing import fallback_provider_for, provider_for_task
from learnloop.ai.runtime import check_ai_runtime
from learnloop.codex.client import CodexUnavailable, make_codex_client
from learnloop.codex.runtime import check_codex_runtime


def ready_grading_provider(vault) -> tuple[str, Any, Any | None]:
    selection = provider_for_task(vault.config, "grading")
    provider_name = selection.provider_name
    runtime = runtime_for_provider(vault, provider_name)
    if runtime.ready:
        return provider_name, runtime, client_for_provider(vault, provider_name)
    fallback = fallback_provider_for(vault.config, selection)
    if fallback:
        fallback_runtime = runtime_for_provider(vault, fallback)
        if fallback_runtime.ready:
            return fallback, fallback_runtime, client_for_provider(vault, fallback)
    return provider_name, runtime, None


def runtime_for_provider(vault, provider_name: str):
    if provider_name in vault.config.ai.providers:
        return check_ai_runtime(vault.root, vault.config, provider_name=provider_name)
    if provider_name == "codex":
        return check_codex_runtime(vault.root, vault.config.codex)
    return check_ai_runtime(vault.root, vault.config, provider_name=provider_name)


def client_for_provider(vault, provider_name: str):
    if provider_name in vault.config.ai.providers:
        return _ai_client(vault, provider_name)
    if provider_name == "codex":
        return _codex_client(vault)
    return _ai_client(vault, provider_name)


def grading_source_for_provider(provider_name: str) -> str:
    return "codex" if provider_name == "codex" else "ai"


def provider_label(provider_name: str) -> str:
    return "Codex" if provider_name == "codex" else f"AI provider {provider_name}"


def _codex_client(vault):
    try:
        return make_codex_client(vault.config.codex, vault.root)
    except CodexUnavailable:
        return None


def _ai_client(vault, provider_name: str):
    try:
        return make_ai_provider_client(vault.config, vault.root, provider_name=provider_name)
    except CodexUnavailable:
        return None
