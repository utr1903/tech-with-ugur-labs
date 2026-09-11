"""Hand-computed checks for finite scenario-derived bounds."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import numpy as np
import numpy.testing as npt
import pytest

from app.contracts import FloatArray, Scenario
from app.logging_setup import get_logger
from app.scenario import derive_bounds, load_scenario, validate_scenario

LAB_ROOT = Path(__file__).parents[3]


def _scenario() -> Scenario:
    return load_scenario(LAB_ROOT / "scenario.yaml", log=get_logger(test="bounds"))


def _frozen(values: FloatArray) -> FloatArray:
    result = np.array(values, dtype=np.float64, copy=True)
    result.flags.writeable = False
    return result


def test_bounds_apply_investment_timing_and_factory_availability() -> None:
    bounds = derive_bounds(_scenario())

    npt.assert_allclose(
        bounds.production_max,
        [[120.0, 180.0, 190.0], [0.0, 110.0, 120.0]],
    )
    npt.assert_allclose(
        bounds.electricity_max,
        [[290.0, 415.0, 440.0], [0.0, 238.0, 261.0]],
    )
    npt.assert_allclose(bounds.high_production_max, [120.0, 290.0, 310.0])
    assert bounds.demand_max[0, 0, 0] == pytest.approx(115.2)


def test_high_product_bound_uses_demand_when_it_is_tighter() -> None:
    scenario = _scenario()
    demand_base = np.full_like(scenario.demand_base, 20.0)
    demand_base[:, 1, :] = 21.0
    constrained = replace(
        scenario,
        demand_base=_frozen(demand_base),
        price_sensitivity=_frozen(np.zeros_like(scenario.price_sensitivity)),
        sales_alpha=_frozen(np.zeros_like(scenario.sales_alpha)),
        sales_beta=_frozen(np.full_like(scenario.sales_beta, 0.01)),
    )
    validate_scenario(constrained)

    bounds = derive_bounds(constrained)

    npt.assert_allclose(bounds.high_production_max, [84.0, 84.0, 84.0])


def test_demand_bound_uses_internal_quadratic_vertex() -> None:
    scenario = _scenario()
    alpha = scenario.sales_alpha.copy()
    beta = scenario.sales_beta.copy()
    alpha[0, 0] = 4.0
    beta[0, 0] = 1.0
    changed = replace(
        scenario,
        sales_alpha=_frozen(alpha),
        sales_beta=_frozen(beta),
    )
    validate_scenario(changed)

    bounds = derive_bounds(changed)

    assert bounds.demand_max[0, 0, 0] == 92.0


def test_cash_bound_matches_hand_computed_default_cost_envelope() -> None:
    bounds = derive_bounds(_scenario())

    assert bounds.cash_abs_max == pytest.approx(5487.668)
