"""Small complete scenarios and real-solver fixtures for equation tests."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from app.contracts import Scenario, Tariff
from app.logging_setup import Logger, get_logger
from app.model import BuiltModel, build_model
from app.scenario import derive_bounds, load_scenario
from app.scenario.validation import validate_scenario


@pytest.fixture
def log() -> Logger:
    return get_logger(test="model")


@pytest.fixture
def tiny_scenario(log: Logger) -> Scenario:
    """Keep all axes and valid positive team floors with small capacities."""
    base = load_scenario(Path(__file__).parents[3] / "scenario.yaml", log=log)
    minimum = (base.staff_min > 0).astype(np.float64)
    maximum = 2 * minimum
    maximum[:, 3, :] = 4
    salary = 0.1 * minimum
    salary[2:, 1, :] = 1.0
    scenario = replace(
        base,
        solver=replace(base.solver, time_limit_seconds=5.0, relative_gap=0.0),
        staff_min=minimum,
        staff_max=maximum,
        salary=salary,
        support_fixed=np.ones((4, 3)),
        support_ratios=np.zeros((4, 3, 3)),
        regional_budget=np.full((4, 3), 100.0),
        office_overhead=np.zeros((4, 3)),
        investment_cost=np.ones(4),
        central_allowance=np.full(3, 4.0),
        rd_alpha=np.full((2, 3), 2.0),
        rd_beta=np.full((2, 3), 0.25),
        rd_upgrade_alpha_gain=np.ones(2),
        process_conversion=np.full(3, 0.1),
        initial_process_saving=0.0,
        max_process_saving=0.5,
        material_saving_floor=0.5,
        initial_development_stock=0.0,
        max_development_stock=10.0,
        development_threshold=2.0,
        maintenance_required=np.ones(3),
        factory_capacity=np.full((2, 3), 8.0),
        germany_capacity_gain=np.full(3, 4.0),
        manufacturing_productivity=np.full((2, 3), 4.0),
        manufacturing_effort=np.ones((2, 2)),
        material_requirement=np.ones((2, 2)),
        material_price=np.full((2, 3), 0.2),
        factory_baseline_electricity=np.zeros((2, 3)),
        electricity_per_unit=np.ones((2, 2)),
        factory_overhead=np.zeros((2, 3)),
        tariff=Tariff(
            np.tile([0.0, 2.0, 4.0, 20.0], (2, 1)), np.tile([0.1, 0.2, 0.3], (2, 1))
        ),
        shipping_cost=np.full((2, 4, 2), 0.05),
        demand_base=np.broadcast_to(
            np.array([10.0, 11.0])[None, :, None], (4, 2, 3)
        ).copy(),
        reference_price=np.full((4, 2, 3), 2.0),
        price_min=np.full((4, 2, 3), 2.0),
        price_max=np.full((4, 2, 3), 2.0),
        price_sensitivity=np.ones((4, 2, 3)),
        sales_alpha=np.ones((4, 3)),
        sales_beta=np.full((4, 3), 0.1),
    )
    validate_scenario(scenario)
    return scenario


@pytest.fixture
def built(tiny_scenario: Scenario, log: Logger) -> BuiltModel:
    return build_model(tiny_scenario, derive_bounds(tiny_scenario), log=log)
