"""Rejection tests for the generator, frontier, algorithm and study blocks.

Every case breaks exactly one thing in the shipped scenario and asserts the
error names the YAML path a reader would have to edit.
"""

from __future__ import annotations

import pytest

from app.conftest import Document, MutatedLoader, Mutation
from app.errors import ScenarioError


def _unknown_market_mode(document: Document) -> None:
    document["market"]["mode"] = "lognormal"


def _too_few_scenarios(document: Document) -> None:
    document["market"]["scenarios"] = 99


def _too_few_out_of_sample_scenarios(document: Document) -> None:
    document["market"]["out_of_sample_scenarios"] = 10


def _colliding_seeds(document: Document) -> None:
    document["market"]["out_of_sample_seed"] = document["market"]["seed"]


def _single_style_factor(document: Document) -> None:
    document["market"]["factor_count"] = 1


def _zero_calm_sigma(document: Document) -> None:
    document["market"]["calm_sigma"] = 0.0


def _certain_stress(document: Document) -> None:
    document["market"]["stress_probability"] = 1.0


def _upward_stress(document: Document) -> None:
    document["market"]["stress_mean"] = 0.05


def _upward_jump(document: Document) -> None:
    document["market"]["jump_mean"] = 0.20


def _infinite_variance_student_t(document: Document) -> None:
    document["market"]["idiosyncratic_df"] = 2.0


def _unknown_jump_name(document: Document) -> None:
    document["market"]["jump_names"] = ["NOT_A_NAME"]


def _repeated_jump_name(document: Document) -> None:
    document["market"]["jump_names"] = ["TCH1", "TCH1"]


def _invert_the_frontier_band(document: Document) -> None:
    document["frontier"]["min_target_monthly"] = 0.05


def _single_frontier_point(document: Document) -> None:
    document["frontier"]["points"] = 1


def _flat_scenario_ladder(document: Document) -> None:
    document["algorithms"]["scenario_ladder"] = [500, 500, 8000]


def _descending_scenario_ladder(document: Document) -> None:
    document["algorithms"]["scenario_ladder"] = [8000, 2000, 500]


def _empty_scenario_ladder(document: Document) -> None:
    document["algorithms"]["scenario_ladder"] = []


def _zero_objective_tolerance(document: Document) -> None:
    document["algorithms"]["objective_relative_tolerance"] = 0.0


def _single_study_seed(document: Document) -> None:
    document["studies"]["seeds"] = 1


def _tiny_study_sample(document: Document) -> None:
    document["studies"]["scenarios"] = 50


def _meaningless_divergence_floor(document: Document) -> None:
    document["studies"]["divergence_ratio_min"] = 1.0


def _negative_tolerance(document: Document) -> None:
    document["tolerances"]["dual_relative"] = -0.01


def _zero_tolerance(document: Document) -> None:
    document["tolerances"]["cvar_agreement_abs"] = 0.0


@pytest.mark.parametrize(
    ("mutate", "fragment"),
    [
        pytest.param(_unknown_market_mode, "market.mode", id="unknown-mode"),
        pytest.param(_too_few_scenarios, "market.scenarios", id="too-few-scenarios"),
        pytest.param(
            _too_few_out_of_sample_scenarios,
            "market.out_of_sample_scenarios",
            id="too-few-out-of-sample",
        ),
        pytest.param(_single_style_factor, "market.factor_count", id="one-factor"),
        pytest.param(
            _colliding_seeds, "market.out_of_sample_seed", id="colliding-seeds"
        ),
        pytest.param(_zero_calm_sigma, "market.calm_sigma", id="zero-calm-sigma"),
        pytest.param(
            _certain_stress, "market.stress_probability", id="always-stressed"
        ),
        pytest.param(_upward_stress, "market.stress_mean", id="upward-stress"),
        pytest.param(_upward_jump, "market.jump_mean", id="upward-jump"),
        pytest.param(
            _infinite_variance_student_t,
            "market.idiosyncratic_df",
            id="infinite-variance",
        ),
        pytest.param(_unknown_jump_name, "market.jump_names", id="unknown-jump-name"),
        pytest.param(_repeated_jump_name, "market.jump_names", id="repeated-jump-name"),
        pytest.param(
            _invert_the_frontier_band,
            "frontier.min_target_monthly",
            id="inverted-frontier",
        ),
        pytest.param(_single_frontier_point, "frontier.points", id="one-point"),
        pytest.param(
            _flat_scenario_ladder, "algorithms.scenario_ladder", id="flat-ladder"
        ),
        pytest.param(
            _descending_scenario_ladder,
            "algorithms.scenario_ladder",
            id="descending-ladder",
        ),
        pytest.param(
            _empty_scenario_ladder, "algorithms.scenario_ladder", id="empty-ladder"
        ),
        pytest.param(
            _zero_objective_tolerance,
            "algorithms.objective_relative_tolerance",
            id="zero-objective-tolerance",
        ),
        pytest.param(_single_study_seed, "studies.seeds", id="one-seed"),
        pytest.param(_tiny_study_sample, "studies.scenarios", id="tiny-study"),
        pytest.param(
            _meaningless_divergence_floor,
            "studies.divergence_ratio_min",
            id="divergence-floor-of-one",
        ),
        pytest.param(
            _negative_tolerance, "tolerances.dual_relative", id="negative-tolerance"
        ),
        pytest.param(
            _zero_tolerance, "tolerances.cvar_agreement_abs", id="zero-tolerance"
        ),
    ],
)
def test_the_loader_rejects_invalid_settings(
    load_mutated: MutatedLoader, mutate: Mutation, fragment: str
) -> None:
    with pytest.raises(ScenarioError) as raised:
        load_mutated(mutate)

    assert fragment in str(raised.value)


def test_the_student_t_rejection_explains_why_the_variance_must_exist(
    load_mutated: MutatedLoader,
) -> None:
    """At two degrees of freedom the unit-variance rescaling is undefined.

    The generator divides the Student-t draw by `sqrt(df / (df - 2))` so it
    carries `idiosyncratic_sigma` exactly. At `df = 2` that factor is
    infinite, and the whole moment-matching claim collapses with it.
    """
    with pytest.raises(ScenarioError) as raised:
        load_mutated(_infinite_variance_student_t)

    assert "finite variance" in str(raised.value)
