from __future__ import annotations

from dataclasses import dataclass

from learnloop.clock import Clock, utc_now_iso
from learnloop.db.repositories import Repository
from learnloop.services.goal_projection import resolve_goal_scope
from learnloop.services.mastery import initial_mastery_state_for_learning_object
from learnloop.vault.hashes import practice_item_hash
from learnloop.vault.models import LoadedVault


@dataclass(frozen=True)
class StateSyncResult:
    practice_item_states_created: int = 0
    practice_item_states_updated: int = 0
    practice_item_states_deactivated: int = 0
    mastery_states_created: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "practice_item_states_created": self.practice_item_states_created,
            "practice_item_states_updated": self.practice_item_states_updated,
            "practice_item_states_deactivated": self.practice_item_states_deactivated,
            "mastery_states_created": self.mastery_states_created,
        }


def sync_vault_state(
    vault: LoadedVault,
    repository: Repository,
    *,
    clock: Clock | None = None,
) -> StateSyncResult:
    """Reconcile YAML-owned entities with derived SQLite rows.

    The MVP policy for Practice Item content-hash changes is conservative:
    refresh the hash and reactivate the item, while preserving existing FSRS
    memory state until replay/content-event machinery exists.
    """

    created_items = 0
    updated_items = 0
    deactivated_items = 0
    created_mastery = 0

    item_states = repository.practice_item_states()
    now = utc_now_iso(clock)
    live_item_ids = set(vault.practice_items)

    for item_id, item in vault.practice_items.items():
        content_hash = practice_item_hash(item)
        state = item_states.get(item_id)
        if state is None:
            repository.upsert_practice_item_state(
                item_id,
                active=True,
                content_hash=content_hash,
                clock=clock,
            )
            created_items += 1
            continue

        if (not state.active) or state.content_hash != content_hash:
            repository.upsert_practice_item_state(
                item_id,
                difficulty=state.difficulty,
                stability=state.stability,
                retrievability=state.retrievability,
                due_at=state.due_at,
                active=True,
                content_hash=content_hash,
                last_attempt_at=state.last_attempt_at,
                clock=clock,
            )
            updated_items += 1

    for item_id, state in item_states.items():
        if item_id in live_item_ids or not state.active:
            continue
        repository.upsert_practice_item_state(
            item_id,
            difficulty=state.difficulty,
            stability=state.stability,
            retrievability=state.retrievability,
            due_at=state.due_at,
            active=False,
            content_hash=state.content_hash,
            last_attempt_at=state.last_attempt_at,
            clock=clock,
        )
        deactivated_items += 1

    mastery_states = repository.mastery_states()
    for learning_object_id, learning_object in vault.learning_objects.items():
        if learning_object_id in mastery_states:
            continue
        repository.upsert_mastery_state(
            initial_mastery_state_for_learning_object(vault, repository, learning_object_id, now)
        )
        created_mastery += 1

    _enter_initial_probes(vault, repository, clock=clock)

    return StateSyncResult(
        practice_item_states_created=created_items,
        practice_item_states_updated=updated_items,
        practice_item_states_deactivated=deactivated_items,
        mastery_states_created=created_mastery,
    )


def _enter_initial_probes(
    vault: LoadedVault,
    repository: Repository,
    *,
    clock: Clock | None,
) -> None:
    mastery_states = repository.mastery_states()
    # Explicit goal scope (no concept-edge expansion): an LO is in scope when any
    # active goal's resolved facet scope names it. Computed once per sync.
    goal_scope_los: set[str] = set()
    for goal in vault.goals:
        if goal.status != "active":
            continue
        goal_scope_los |= set(resolve_goal_scope(vault, goal, repository))
    for learning_object_id, learning_object in vault.learning_objects.items():
        if learning_object.status != "active":
            continue
        if repository.probe_state(learning_object_id) is not None:
            continue
        mastery = mastery_states.get(learning_object_id)
        if mastery is not None and mastery.last_evidence_at is not None:
            continue
        if _has_active_local_item(vault, repository, learning_object_id):
            _enter_initial_probe_if_possible(vault, repository, learning_object_id, clock=clock)
            continue
        if learning_object_id in goal_scope_los:
            _enter_initial_probe_if_possible(vault, repository, learning_object_id, clock=clock)


def _enter_initial_probe_if_possible(
    vault: LoadedVault,
    repository: Repository,
    learning_object_id: str,
    *,
    clock: Clock | None,
) -> None:
    if repository.probe_state(learning_object_id) is not None:
        return
    if _has_active_local_item(vault, repository, learning_object_id):
        from learnloop.services.probes import enter_probe

        enter_probe(vault, repository, learning_object_id, clock=clock)
        return
    repository.insert_elicitation_event(
        {
            "session_id": None,
            "selected_practice_item_id": None,
            "target_scope": {"learning_object_id": learning_object_id},
            "policy": "probe_eig",
            "candidate_scores": {},
            "expected_information_gain": 0.0,
            "selected_reason": "no existing Practice Item can probe this new active-goal Learning Object",
            "hypothesis_set_id": None,
            "trigger": "probe_phase_local_pi_inadequate",
            "fallback_outcome": "existing_pi_inadequate",
        },
        clock=clock,
    )


def _has_active_local_item(vault: LoadedVault, repository: Repository, learning_object_id: str) -> bool:
    item_states = repository.practice_item_states()
    for item in vault.practice_items.values():
        if item.learning_object_id != learning_object_id:
            continue
        state = item_states.get(item.id)
        if state is None or state.active:
            return True
    return False
