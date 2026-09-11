"""R&D output, lagged knowledge, and high-product prerequisites."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from app.contracts import Scenario
from app.logging_setup import Logger
from app.model import BuiltModel, build_model, solve_model
from app.scenario import derive_bounds


def test_process_saving_persists_when_later_rd_is_zero(
    built: BuiltModel,
    tiny_scenario: Scenario,
    log: Logger,
) -> None:
    built.model.addMatrixCons(
        built.variables.rd_allocation[:, 0, :]
        == np.array([[2, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]])
    )
    result = solve_model(built, tiny_scenario, log=log)
    assert result.decisions is not None
    assert result.decisions.process_saving == pytest.approx([0, 0.2, 0.2])


@pytest.mark.parametrize("gate", ["development", "maintenance"])
def test_high_product_requires_development_and_maintenance(
    tiny_scenario: Scenario,
    log: Logger,
    gate: str,
) -> None:
    scenario = replace(tiny_scenario, initial_development_stock=2.0)
    if gate == "maintenance":
        scenario = replace(scenario, maintenance_required=np.full(3, 100.0))
    else:
        scenario = replace(scenario, initial_development_stock=0.0)
    built = build_model(scenario, derive_bounds(scenario), log=log)
    if gate == "development":
        built.model.addMatrixCons(built.variables.rd_allocation[:, 1, :] == 0)
    result = solve_model(built, scenario, log=log)
    assert result.decisions is not None
    assert result.decisions.production[:, 1, :].sum() == pytest.approx(0, abs=1e-7)
    assert result.decisions.sales[:, 1, :].sum() == pytest.approx(0, abs=1e-7)


def test_development_has_one_year_delay(
    built: BuiltModel, tiny_scenario: Scenario, log: Logger
) -> None:
    built.model.addMatrixCons(
        built.variables.rd_allocation[:, 1, :]
        == np.array([[2, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]])
    )
    built.model.addMatrixCons(built.variables.product_active == [0, 1, 1])
    result = solve_model(built, tiny_scenario, log=log)
    assert result.decisions is not None
    assert result.decisions.development_stock == pytest.approx([0, 2, 2])


def test_active_product_may_produce_zero(tiny_scenario: Scenario, log: Logger) -> None:
    scenario = replace(tiny_scenario, initial_development_stock=2.0)
    built = build_model(scenario, derive_bounds(scenario), log=log)
    built.model.addMatrixCons(built.variables.product_active == 1)
    built.model.addMatrixCons(built.variables.production[:, 1, :] == 0)
    result = solve_model(built, scenario, log=log)
    assert result.decisions is not None
    assert result.decisions.product_active == pytest.approx([1, 1, 1])


def test_inactive_product_cannot_produce(
    built: BuiltModel, tiny_scenario: Scenario, log: Logger
) -> None:
    built.model.addMatrixCons(built.variables.product_active == 0)
    built.model.addCons(built.variables.production[0, 1, 1] >= 1)
    assert solve_model(built, tiny_scenario, log=log).decisions is None


@pytest.mark.parametrize(
    ("allocation", "feasible"),
    [((3, 5, 5), True), ((4, 5, 5), False), ((3, 6, 5), False)],
)
def test_rd_upgrade_increases_concave_output_after_start(
    built: BuiltModel,
    tiny_scenario: Scenario,
    log: Logger,
    allocation: tuple[int, int, int],
    feasible: bool,
) -> None:
    # n=2 yields 2*2 - .25*4 = 3; upgrade adds 1*2 in later years.
    built.model.addMatrixCons(built.variables.headcount[0, 0] == 2)
    built.model.addMatrixCons(built.variables.investment_start[0] == [1, 0, 0])
    built.model.addMatrixCons(built.variables.rd_allocation[0, 2] == allocation)
    result = solve_model(built, tiny_scenario, log=log)
    assert result.metadata.has_incumbent is feasible


def test_final_year_knowledge_allocation_is_legal_without_payoff(
    built: BuiltModel,
    tiny_scenario: Scenario,
    log: Logger,
) -> None:
    allocation = np.zeros((4, 3, 3))
    allocation[0, 0, 2] = 1
    allocation[0, 1, 2] = 1
    built.model.addMatrixCons(built.variables.rd_allocation == allocation)
    result = solve_model(built, tiny_scenario, log=log)
    assert result.decisions is not None
    assert result.decisions.process_saving == pytest.approx([0, 0, 0])
    assert result.decisions.development_stock == pytest.approx([0, 0, 0])
    assert result.decisions.rd_allocation[0, :2, 2] == pytest.approx([1, 1])
