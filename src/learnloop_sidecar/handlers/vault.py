from __future__ import annotations

from pathlib import Path
from typing import Any

from learnloop.ids import kebab_case
from learnloop.vault.loader import add_subject, init_vault
from learnloop_sidecar.context import SidecarContext
from learnloop_sidecar.dto import ParamsModel, versioned
from learnloop_sidecar.errors import SidecarError
from learnloop_sidecar.registry import method


class CreateVaultInput(ParamsModel):
    path: str
    # Optional first subject to seed at creation time (title → kebab-case id).
    # The NewVault wizard uses this so the bootstrap study-map build has a
    # subject to bind to; omit it and the vault is created with no subjects.
    subject: str | None = None


@method("create_vault", CreateVaultInput)
def create_vault(ctx: SidecarContext, params: CreateVaultInput) -> dict[str, Any]:
    """Create (or re-initialize) a LearnLoop vault at ``path`` and return its root.

    Wraps :func:`learnloop.vault.loader.init_vault` (the same primitive the
    ``learnloop init`` CLI command uses). ``init_vault`` is idempotent — every
    write is guarded — so pointing it at an existing vault is a safe no-op that
    just returns the root. It does NOT bind the sidecar to the new vault; the
    caller re-selects it (Rust ``select_vault`` respawns against the new path)
    and then ``load_vault``, mirroring how the vault switcher works elsewhere.

    Guard: refuse a directory that already has unrelated content and is not a
    vault, so we never scatter vault scaffolding into someone's populated folder.
    """

    raw = params.path.strip()
    if not raw:
        raise SidecarError("invalid_path", "A vault directory path is required.")

    target = Path(raw).expanduser()
    if target.exists():
        if not target.is_dir():
            raise SidecarError("invalid_path", f"{target} exists and is not a directory.")
        already_vault = (target / "learnloop.toml").exists()
        if not already_vault and any(target.iterdir()):
            raise SidecarError(
                "vault_dir_not_empty",
                (
                    f"{target} is not empty and is not a LearnLoop vault. "
                    "Choose an empty directory or an existing vault."
                ),
            )

    created = init_vault(target)

    subject_id: str | None = None
    subject_title = (params.subject or "").strip()
    if subject_title:
        subject_id = kebab_case(subject_title)
        add_subject(created, subject_id, subject_title)

    return versioned({"vault_root": str(created), "subject_id": subject_id})
