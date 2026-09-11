from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.contracts import DecisionValues, Scenario
from app.logging_setup import get_logger
from app.scenario import load_scenario


@pytest.fixture
def scenario() -> Scenario:
    return load_scenario(Path(__file__).parents[2] / "scenario.yaml", log=get_logger())


@pytest.fixture
def feasible_values(scenario: Scenario) -> DecisionValues:
    n = scenario.staff_min.copy()
    n[3, 1] = 0
    n[:, 3] = np.maximum(
        n[:, 3],
        np.ceil(
            scenario.support_fixed + np.sum(scenario.support_ratios * n[:, :3], axis=1)
        ),
    )
    return DecisionValues(
        n,
        np.zeros((4, 3)),
        np.zeros((4, 3, 3)),
        np.full(3, scenario.initial_process_saving),
        np.full(3, scenario.initial_development_stock),
        np.zeros(3),
        np.zeros((4, 2, 3)),
        scenario.reference_price.copy(),
        np.zeros((4, 2, 3)),
        np.zeros((2, 2, 3)),
        np.zeros((2, 4, 2, 3)),
        np.array([scenario.factory_baseline_electricity[0], np.zeros(3)]),
        np.array([[0.25, 0.275, 0.30], np.zeros(3)]),
        -1000.0,
    )
