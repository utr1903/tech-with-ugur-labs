"""Behaviour tests for the scenario loader and its semantic validation.

The rejection table mutates the shipped file rather than restating it, so a
change to `scenario.yaml` cannot quietly leave these tests validating a
scenario the lab no longer ships.
"""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import yaml

from app.contracts import Scenario
from app.errors import ScenarioError
from app.logging_setup import Logger
from app.market import market_factor_moments
from app.scenario import load_scenario

Document = dict[str, Any]
Mutation = Callable[[Document], None]


@pytest.fixture(scope="session")
def document(scenario_path: Path) -> Document:
    """Parse the shipped scenario into a plain dictionary for mutation."""
    parsed = yaml.safe_load(scenario_path.read_text(encoding="utf-8"))
    assert isinstance(parsed, dict)
    return parsed


def _load_mutated(
    tmp_path: Path, document: Document, mutate: Mutation, log: Logger
) -> Scenario:
    """Apply one mutation to a copy of the shipped file and load the result."""
    candidate = deepcopy(document)
    mutate(candidate)
    path = tmp_path / "scenario.yaml"
    path.write_text(yaml.safe_dump(candidate, sort_keys=False), encoding="utf-8")
    return load_scenario(path, log=log)


def test_the_shipped_scenario_loads_with_the_documented_shape(
    scenario: Scenario,
) -> None:
    universe = scenario.universe

    assert len(universe.names) == 30
    assert len(set(universe.names)) == 30
    assert len(universe.sectors) == 6
    assert universe.sector_of.shape == (30,)
    assert universe.sector_matrix.shape == (6, 30)
    assert universe.market_beta.shape == (30,)
    assert universe.start_book.shape == (30,)
    assert scenario.cvar_beta == 0.95
    assert scenario.returns_csv is None


def test_every_name_sits_in_exactly_one_sector_and_every_sector_holds_five(
    scenario: Scenario,
) -> None:
    matrix = scenario.universe.sector_matrix

    assert np.array_equal(matrix.sum(axis=0), np.ones(30))
    assert np.array_equal(matrix.sum(axis=1), np.full(6, 5.0))


def test_every_array_in_the_universe_is_read_only(scenario: Scenario) -> None:
    universe = scenario.universe
    arrays = (
        universe.sector_of,
        universe.sector_matrix,
        universe.market_beta,
        universe.expected_return,
        universe.borrow_fee_annual,
        universe.half_spread,
        universe.start_book,
    )

    assert not any(array.flags.writeable for array in arrays)


def test_expected_return_folds_the_market_drift_into_alpha(
    scenario: Scenario, document: Document
) -> None:
    market_mean, _ = market_factor_moments(scenario.market)
    alpha = np.array(
        [entry["alpha_monthly"] for entry in document["universe"]["names"]]
    )

    expected = alpha + scenario.universe.market_beta * market_mean

    assert scenario.universe.expected_return == pytest.approx(expected)
    assert market_mean < 0.0


def test_the_shipped_start_book_satisfies_the_shipped_desk_limits(
    scenario: Scenario,
) -> None:
    universe, limits = scenario.universe, scenario.limits
    book = universe.start_book

    assert float(np.abs(book).sum()) <= limits.gross_leverage_max
    assert limits.net_exposure_min <= float(book.sum()) <= limits.net_exposure_max
    beta = float(universe.market_beta @ book)
    assert limits.beta_min <= beta <= limits.beta_max
    assert float(np.abs(book).max()) <= limits.name_gross_cap
    assert float(np.abs(universe.sector_matrix @ book).max()) <= limits.sector_net_cap
    assert (
        float((universe.sector_matrix @ np.abs(book)).max()) <= limits.sector_gross_cap
    )


def test_the_shipped_scenario_survives_a_dump_and_reload(
    tmp_path: Path, document: Document, log: Logger, scenario: Scenario
) -> None:
    reloaded = _load_mutated(tmp_path, document, lambda _: None, log)

    assert reloaded.universe.names == scenario.universe.names
    assert reloaded.market == scenario.market
    assert reloaded.limits == scenario.limits


def _add_unknown_root_key(document: Document) -> None:
    document["surprise"] = 1


def _drop_turnover_max(document: Document) -> None:
    del document["desk_limits"]["turnover_max"]


def _certain_cvar_beta(document: Document) -> None:
    document["cvar_beta"] = 1.0


def _impossible_cvar_beta(document: Document) -> None:
    document["cvar_beta"] = 0.0


def _nan_market_beta(document: Document) -> None:
    document["universe"]["names"][3]["market_beta"] = float("nan")


def _negative_borrow_fee(document: Document) -> None:
    document["universe"]["names"][0]["borrow_fee_annual"] = -0.01


def _drop_one_name(document: Document) -> None:
    document["universe"]["names"].pop()


def _duplicate_a_name(document: Document) -> None:
    document["universe"]["names"][1]["name"] = document["universe"]["names"][0]["name"]


def _move_a_name_between_sectors(document: Document) -> None:
    document["universe"]["names"][0]["sector"] = "staples"


def _invert_the_net_exposure_band(document: Document) -> None:
    document["desk_limits"]["net_exposure_min"] = 0.20


def _zero_gross_leverage(document: Document) -> None:
    document["desk_limits"]["gross_leverage_max"] = 0.0


def _unreachable_name_cap(document: Document) -> None:
    document["desk_limits"]["name_gross_cap"] = 0.01


def _overleveraged_start_book(document: Document) -> None:
    for entry in document["universe"]["names"]:
        entry["start_weight"] = 0.12


def _invert_the_frontier_band(document: Document) -> None:
    document["frontier"]["min_target_monthly"] = 0.05


def _single_frontier_point(document: Document) -> None:
    document["frontier"]["points"] = 1


def _too_few_scenarios(document: Document) -> None:
    document["market"]["scenarios"] = 99


def _unknown_market_mode(document: Document) -> None:
    document["market"]["mode"] = "lognormal"


def _unknown_jump_name(document: Document) -> None:
    document["market"]["jump_names"] = ["NOT_A_NAME"]


def _flat_scenario_ladder(document: Document) -> None:
    document["algorithms"]["scenario_ladder"] = [500, 500, 8000]


def _single_study_seed(document: Document) -> None:
    document["studies"]["seeds"] = 1


def _negative_tolerance(document: Document) -> None:
    document["tolerances"]["dual_relative"] = -0.01


@pytest.mark.parametrize(
    ("mutate", "fragment"),
    [
        pytest.param(_add_unknown_root_key, "unexpected field", id="unknown-root-key"),
        pytest.param(_drop_turnover_max, "desk_limits.turnover_max", id="missing-key"),
        pytest.param(_certain_cvar_beta, "cvar_beta", id="beta-one"),
        pytest.param(_impossible_cvar_beta, "cvar_beta", id="beta-zero"),
        pytest.param(
            _nan_market_beta, "universe.names.TCH4.market_beta", id="nan-beta"
        ),
        pytest.param(_negative_borrow_fee, "borrow_fee_annual", id="negative-borrow"),
        pytest.param(_drop_one_name, "universe.names", id="twenty-nine-names"),
        pytest.param(_duplicate_a_name, "universe.names", id="duplicate-name"),
        pytest.param(
            _move_a_name_between_sectors, "universe.sectors", id="short-sector"
        ),
        pytest.param(
            _invert_the_net_exposure_band,
            "desk_limits.net_exposure_min",
            id="inverted-net-band",
        ),
        pytest.param(
            _zero_gross_leverage, "desk_limits.gross_leverage_max", id="zero-gross"
        ),
        pytest.param(
            _unreachable_name_cap, "desk_limits.name_gross_cap", id="unreachable-cap"
        ),
        pytest.param(
            _overleveraged_start_book, "universe.start_book", id="illegal-start-book"
        ),
        pytest.param(
            _invert_the_frontier_band,
            "frontier.min_target_monthly",
            id="inverted-frontier",
        ),
        pytest.param(_single_frontier_point, "frontier.points", id="one-point"),
        pytest.param(_too_few_scenarios, "market.scenarios", id="too-few-scenarios"),
        pytest.param(_unknown_market_mode, "market.mode", id="unknown-mode"),
        pytest.param(_unknown_jump_name, "market.jump_names", id="unknown-jump-name"),
        pytest.param(
            _flat_scenario_ladder, "algorithms.scenario_ladder", id="flat-ladder"
        ),
        pytest.param(_single_study_seed, "studies.seeds", id="one-seed"),
        pytest.param(
            _negative_tolerance, "tolerances.dual_relative", id="negative-tolerance"
        ),
    ],
)
def test_the_loader_rejects_an_invalid_scenario_naming_the_field(
    tmp_path: Path,
    document: Document,
    log: Logger,
    mutate: Mutation,
    fragment: str,
) -> None:
    with pytest.raises(ScenarioError) as raised:
        _load_mutated(tmp_path, document, mutate, log)

    assert fragment in str(raised.value)


def test_the_loader_refuses_a_document_that_tries_to_construct_a_python_object(
    tmp_path: Path, log: Logger
) -> None:
    sentinel = tmp_path / "executed.txt"
    path = tmp_path / "scenario.yaml"
    path.write_text(
        f'cvar_beta: !!python/object/apply:os.system ["touch {sentinel}"]\n',
        encoding="utf-8",
    )

    with pytest.raises(ScenarioError):
        load_scenario(path, log=log)

    assert not sentinel.exists()


def test_the_loader_reports_a_missing_file(tmp_path: Path, log: Logger) -> None:
    with pytest.raises(ScenarioError, match="could not load"):
        load_scenario(tmp_path / "absent.yaml", log=log)


def test_the_loader_rejects_a_boolean_where_a_number_belongs(
    tmp_path: Path, document: Document, log: Logger
) -> None:
    def mutate(candidate: Document) -> None:
        candidate["headline_target_monthly"] = True

    with pytest.raises(ScenarioError, match="headline_target_monthly"):
        _load_mutated(tmp_path, document, mutate, log)


def test_the_loader_rejects_an_unknown_key_inside_a_name_entry(
    tmp_path: Path, document: Document, log: Logger
) -> None:
    def mutate(candidate: Document) -> None:
        candidate["universe"]["names"][0]["sector_weight"] = 1.0

    with pytest.raises(ScenarioError, match="universe.names.TCH1.sector_weight"):
        _load_mutated(tmp_path, document, mutate, log)


def test_the_loader_rejects_a_sector_no_name_can_belong_to(
    tmp_path: Path, document: Document, log: Logger
) -> None:
    def mutate(candidate: Document) -> None:
        candidate["universe"]["names"][0]["sector"] = "crypto"

    with pytest.raises(ScenarioError, match="universe.names.TCH1.sector"):
        _load_mutated(tmp_path, document, mutate, log)
