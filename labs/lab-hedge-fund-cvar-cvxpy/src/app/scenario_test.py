"""Behaviour tests for the scenario loader's structural contract.

These cover the mapping from YAML text to the frozen dataclasses and the
failures that mapping catches. The semantic rules layered on top of it —
whether the numbers make sense together — are tested in `validation_test.py`
and `validation_settings_test.py`.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.conftest import Document, MutatedLoader
from app.contracts import Scenario
from app.errors import ScenarioError
from app.logging_setup import Logger
from app.market_moments import market_factor_moments
from app.scenario import load_scenario


def test_the_loader_maps_every_yaml_column_onto_the_right_field(
    scenario: Scenario, document: Document
) -> None:
    """The five per-name columns must not be transposed or swapped.

    Nothing downstream would notice a borrow fee parsed into `half_spread`:
    both are small positive numbers that pass every semantic rule. Only a
    direct comparison against the source text catches it.
    """
    universe = scenario.universe
    entries = document["universe"]["names"]

    assert universe.names == tuple(entry["name"] for entry in entries)
    assert universe.sectors == tuple(document["universe"]["sectors"])
    assert universe.market_beta == pytest.approx(
        [entry["market_beta"] for entry in entries]
    )
    assert universe.borrow_fee_annual == pytest.approx(
        [entry["borrow_fee_annual"] for entry in entries]
    )
    assert universe.half_spread == pytest.approx(
        [entry["half_spread"] for entry in entries]
    )
    assert universe.start_book == pytest.approx(
        [entry["start_weight"] for entry in entries]
    )
    assert scenario.cvar_beta == document["cvar_beta"]
    assert scenario.headline_target_monthly == document["headline_target_monthly"]
    assert scenario.returns_csv is None


def test_each_name_lands_in_the_sector_its_entry_names(
    scenario: Scenario, document: Document
) -> None:
    universe = scenario.universe
    entries = document["universe"]["names"]

    resolved = [universe.sectors[int(index)] for index in universe.sector_of]

    assert resolved == [entry["sector"] for entry in entries]
    assert np.array_equal(
        universe.sector_matrix[universe.sector_of, np.arange(len(universe.names))],
        np.ones(len(universe.names)),
    )


def test_the_loader_reads_every_settings_block(
    scenario: Scenario, document: Document
) -> None:
    assert (
        scenario.limits.gross_leverage_max
        == document["desk_limits"]["gross_leverage_max"]
    )
    assert scenario.limits.turnover_max == document["desk_limits"]["turnover_max"]
    assert scenario.market.mode == document["market"]["mode"]
    assert scenario.market.seed == document["market"]["seed"]
    assert scenario.market.jump_names == tuple(document["market"]["jump_names"])
    assert scenario.frontier.points == document["frontier"]["points"]
    assert scenario.algorithms.scenario_ladder == tuple(
        document["algorithms"]["scenario_ladder"]
    )
    assert scenario.studies.seeds == document["studies"]["seeds"]
    assert scenario.tolerances.dual_relative == document["tolerances"]["dual_relative"]


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
    assert not np.allclose(scenario.universe.expected_return, alpha)


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


def test_the_shipped_scenario_survives_a_dump_and_reload(
    load_mutated: MutatedLoader, scenario: Scenario
) -> None:
    reloaded = load_mutated(lambda _: None)

    assert reloaded.universe.names == scenario.universe.names
    assert reloaded.market == scenario.market
    assert reloaded.limits == scenario.limits


def test_the_loader_rejects_an_unknown_root_key(load_mutated: MutatedLoader) -> None:
    def mutate(candidate: Document) -> None:
        candidate["surprise"] = 1

    with pytest.raises(ScenarioError, match="unexpected field"):
        load_mutated(mutate)


def test_the_loader_names_a_missing_field_by_its_full_path(
    load_mutated: MutatedLoader,
) -> None:
    def mutate(candidate: Document) -> None:
        del candidate["desk_limits"]["turnover_max"]

    with pytest.raises(ScenarioError, match="desk_limits.turnover_max"):
        load_mutated(mutate)


def test_the_loader_rejects_a_non_finite_number_by_its_full_path(
    load_mutated: MutatedLoader,
) -> None:
    def mutate(candidate: Document) -> None:
        candidate["universe"]["names"][3]["market_beta"] = float("nan")

    with pytest.raises(ScenarioError, match="universe.names.TCH4.market_beta"):
        load_mutated(mutate)


def test_the_loader_rejects_a_boolean_where_a_number_belongs(
    load_mutated: MutatedLoader,
) -> None:
    def mutate(candidate: Document) -> None:
        candidate["headline_target_monthly"] = True

    with pytest.raises(ScenarioError, match="headline_target_monthly"):
        load_mutated(mutate)


def test_the_loader_rejects_an_unknown_key_inside_a_name_entry(
    load_mutated: MutatedLoader,
) -> None:
    def mutate(candidate: Document) -> None:
        candidate["universe"]["names"][0]["sector_weight"] = 1.0

    with pytest.raises(ScenarioError, match="universe.names.TCH1.sector_weight"):
        load_mutated(mutate)


def test_the_loader_rejects_a_sector_no_name_can_belong_to(
    load_mutated: MutatedLoader,
) -> None:
    def mutate(candidate: Document) -> None:
        candidate["universe"]["names"][0]["sector"] = "crypto"

    with pytest.raises(ScenarioError, match="universe.names.TCH1.sector"):
        load_mutated(mutate)


def test_the_loader_rejects_a_scalar_where_a_list_belongs(
    load_mutated: MutatedLoader,
) -> None:
    def mutate(candidate: Document) -> None:
        candidate["algorithms"]["scenario_ladder"] = 500

    with pytest.raises(
        ScenarioError, match="algorithms.scenario_ladder must be a list"
    ):
        load_mutated(mutate)


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
