from __future__ import annotations

import pytest

from learnloop.clock import FrozenClock
from learnloop.db.repositories import MasteryState, Repository
from learnloop.services.attempts import AttemptDraft, SelfGradeInput, complete_self_graded_attempt
from learnloop.services.scheduler import build_due_queue
from learnloop.services.selection_rewards import SchedulerIntent, score_selection_reward
from learnloop.vault.loader import load_vault
from learnloop.vault.yaml_io import write_yaml

from tests.helpers import ALGORITHM_VERSION, NOW, NOW_ISO, create_basic_vault, seed_due_item

LO_ID = "lo_svd_definition"
ITEM_ID = "pi_svd_define_001"


def _loaded(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    repository = seed_due_item(paths)
    return load_vault(vault_root), paths, repository


def _upsert_uncertainty(repository, *, status: str, top_label: str, opened_by_attempt_id: str) -> None:
    solid = 0.3 if top_label != "facet_solid:recall" else 0.7
    repository.upsert_facet_uncertainty_state(
        {
            "learning_object_id": LO_ID,
            "facet_id": "recall",
            "hypothesis_marginal": {"facet_solid:recall": solid, "facet_absent:recall": 1.0 - solid},
            "uncertainty": 0.5,
            "status": status,
            "opened_by_attempt_id": opened_by_attempt_id,
            "opened_reason": "low_facet_outcome",
            "last_evidence_at": NOW_ISO,
            "algorithm_version": ALGORITHM_VERSION,
            "created_at": NOW_ISO,
            "updated_at": NOW_ISO,
        }
    )


def test_unexamined_facet_on_goal_frontier_scales_by_goal_priority(tmp_path):
    vault, _paths, repository = _loaded(tmp_path)

    queue = build_due_queue(vault, repository, clock=FrozenClock(NOW), persist_explanations=False)

    item = queue[0]
    # Facet "recall" has no evidence -> unexamined -> on the frontier; the
    # basic vault goal reaches the LO's concept with priority 0.8.
    assert item.components["goal_frontier"] == pytest.approx(0.8)
    assert item.components["active_goal"] == pytest.approx(0.8)
    config = vault.config.scheduler
    expected_priority = (
        config.forgetting_risk_weight * item.components["forgetting_risk"]
        + config.active_goal_weight * 0.8
        + config.goal_frontier_weight * 0.8
    )
    assert item.priority == pytest.approx(expected_priority)
    assert "goal frontier weight 0.80" in item.plain_english


def test_known_gap_facet_is_on_frontier_but_uncertain_is_not(tmp_path):
    vault, _paths, repository = _loaded(tmp_path)
    result = complete_self_graded_attempt(
        vault,
        repository,
        AttemptDraft(
            practice_item_id=ITEM_ID,
            learner_answer_md="SVD factorizes into U Sigma V^T.",
            attempt_type="independent_attempt",
        ),
        SelfGradeInput(criterion_points={"correctness": 4}, confidence=5),
        clock=FrozenClock(NOW),
    )

    _upsert_uncertainty(
        repository, status="resolved", top_label="facet_absent:recall", opened_by_attempt_id=result.attempt_id
    )
    queue = build_due_queue(vault, repository, clock=FrozenClock(NOW), persist_explanations=False)
    assert queue[0].components["goal_frontier"] == pytest.approx(0.8)

    _upsert_uncertainty(
        repository, status="open", top_label="facet_absent:recall", opened_by_attempt_id=result.attempt_id
    )
    queue = build_due_queue(vault, repository, clock=FrozenClock(NOW), persist_explanations=False)
    assert queue[0].components["goal_frontier"] == 0.0


def test_no_active_goals_means_no_goal_frontier(tmp_path):
    vault_root = tmp_path / "vault"
    paths = create_basic_vault(vault_root)
    write_yaml(paths.goals_path, {"schema_version": 1, "goals": []})
    repository = seed_due_item(paths)
    vault = load_vault(vault_root)

    queue = build_due_queue(vault, repository, clock=FrozenClock(NOW), persist_explanations=False)

    assert queue[0].components["goal_frontier"] == 0.0
    assert queue[0].components["active_goal"] == 0.0


def test_repair_reward_includes_goal_frontier_term(tmp_path):
    vault_root = tmp_path / "vault"
    create_basic_vault(vault_root)
    vault = load_vault(vault_root)
    item = vault.practice_items[ITEM_ID]
    learning_object = vault.learning_objects[LO_ID]
    mastery = MasteryState(
        learning_object_id=LO_ID,
        logit_mean=0.0,
        logit_variance=1.0,
        evidence_count=1,
        last_evidence_at=NOW_ISO,
        algorithm_version=ALGORITHM_VERSION,
        updated_at=NOW_ISO,
    )

    def reward(goal_frontier: float) -> float:
        return score_selection_reward(
            vault,
            item,
            learning_object,
            mastery=mastery,
            facet_states=[],
            quality_state=None,
            active_errors=[],
            base_components={"recent_error": 0.0, "goal_frontier": goal_frontier},
            probe_eig=0.0,
            intent=SchedulerIntent.REPAIR,
        ).selection_reward

    on_goal = reward(0.8)
    off_goal = reward(0.0)
    assert on_goal - off_goal == pytest.approx(0.15 * 0.8)
