"""Status-safe extraction, finite bounds, and a hand-enumerated cash optimum."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from app.contracts import Scenario
from app.logging_setup import Logger
from app.model import BuiltModel, build_model, solve_model
from app.scenario import derive_bounds, load_scenario


def test_optimum_matches_independently_enumerated_cash(
    built: BuiltModel,
    tiny_scenario: Scenario,
    log: Logger,
) -> None:
    variables = built.variables
    built.model.addMatrixCons(variables.investment_start == 0)
    built.model.addMatrixCons(variables.product_active == 0)
    built.model.addMatrixCons(variables.process_saving == 0)
    built.model.addMatrixCons(variables.sales[1:] == 0)
    for region, team, year in np.ndindex(tiny_scenario.staff_min.shape):
        if (region, team) not in {(2, 1), (3, 1)}:
            built.model.addCons(
                variables.headcount[region, team, year]
                == tiny_scenario.staff_min[region, team, year]
            )
    result = solve_model(built, tiny_scenario, log=log)
    # Per year: 4 or 8 pumps at $2M, mfg salary $1M/person, ten other
    # staff at $0.1M, material $0.2M/pump, shipping $0.05M/pump,
    # electricity $0.6M (four pumps) or $1.8M (eight pumps).
    candidates = [3 * (8 - 1 - 1 - 0.8 - 0.2 - 0.6), 3 * (16 - 2 - 1 - 1.6 - 0.4 - 1.8)]
    assert result.metadata.status == "optimal"
    assert result.decisions is not None
    assert result.decisions.cash_auxiliary == pytest.approx(max(candidates), abs=1e-6)
    assert result.metadata.objective_bound == pytest.approx(max(candidates), abs=1e-6)


def test_extraction_is_numeric_readonly_and_records_original_counts(
    built: BuiltModel,
    tiny_scenario: Scenario,
    log: Logger,
) -> None:
    counts = (built.model.getNVars(), built.model.getNConss())
    result = solve_model(built, tiny_scenario, log=log)
    assert result.decisions is not None
    for value in vars(result.decisions).values():
        if isinstance(value, np.ndarray):
            assert value.dtype == np.float64
            assert np.isfinite(value).all()
            assert not value.flags.writeable
    assert (result.metadata.variable_count, result.metadata.constraint_count) == counts
    assert result.metadata.has_incumbent
    assert result.metadata.solve_seconds >= 0
    assert result.metadata.node_count >= 0
    assert result.metadata.scip_version.startswith("10.")


def test_every_variable_has_finite_bounds(built: BuiltModel) -> None:
    for variable in built.model.getVars():
        assert np.isfinite(variable.getLbOriginal())
        assert np.isfinite(variable.getUbOriginal())
        assert not built.model.isInfinity(abs(variable.getLbOriginal()))
        assert not built.model.isInfinity(abs(variable.getUbOriginal()))


def test_time_limit_without_incumbent_returns_no_decisions(
    built: BuiltModel,
    tiny_scenario: Scenario,
    log: Logger,
) -> None:
    scenario = replace(
        tiny_scenario, solver=replace(tiny_scenario.solver, time_limit_seconds=1e-12)
    )
    result = solve_model(built, scenario, log=log)
    assert result.metadata.status == "timelimit"
    assert not result.metadata.has_incumbent
    assert result.decisions is None
    assert result.metadata.relative_gap is None
    assert result.metadata.objective_bound is None


def test_continuous_price_revenue_has_hand_derived_interior_optimum(
    tiny_scenario: Scenario,
    log: Logger,
) -> None:
    scenario = replace(
        tiny_scenario,
        demand_base=tiny_scenario.demand_base - 8,
        price_min=np.ones((4, 2, 3)),
        price_max=np.full((4, 2, 3), 3.0),
    )
    built = build_model(scenario, derive_bounds(scenario), log=log)
    v = built.variables
    built.model.addMatrixCons(v.investment_start == 0)
    built.model.addMatrixCons(v.product_active == 0)
    built.model.addMatrixCons(v.process_saving == 0)
    built.model.addMatrixCons(v.sales_share == 0)
    built.model.addMatrixCons(v.sales[1:] == 0)
    result = solve_model(built, scenario, log=log)
    assert result.decisions is not None
    # q=4-p, per-unit costs=.2+.05+.1=.35, fixed salaries=2/year.
    # d((p-.35)*(4-p))/dp=4.35-2p, giving p=2.175 and q=1.825.
    assert result.decisions.price[0, 0] == pytest.approx([2.175] * 3, abs=2e-3)
    assert result.decisions.sales[0, 0] == pytest.approx([1.825] * 3, abs=2e-3)
    assert result.decisions.cash_auxiliary == pytest.approx(3.991875, abs=1e-5)


def test_gap_limited_incumbent_keeps_real_status_and_values(log: Logger) -> None:
    scenario = load_scenario(Path(__file__).parents[3] / "scenario.yaml", log=log)
    built = build_model(scenario, derive_bounds(scenario), log=log)
    result = solve_model(built, scenario, log=log)
    assert result.metadata.status == "gaplimit"
    assert result.metadata.has_incumbent
    assert result.decisions is not None
    assert result.metadata.relative_gap is not None
    assert 0 < result.metadata.relative_gap <= scenario.solver.relative_gap
    assert result.metadata.objective_bound is not None
    assert result.metadata.objective_bound >= result.decisions.cash_auxiliary
