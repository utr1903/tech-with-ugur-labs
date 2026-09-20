"""Fixtures shared by the colocated tests.

The shipped scenario is loaded once per session and handed out read-only:
every dataclass in `contracts` is frozen and every array inside one is
non-writeable, so sharing them between tests cannot leak state.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.contracts import FloatArray, GeneratorSettings, Scenario, Universe
from app.logging_setup import Logger, get_logger
from app.scenario import load_scenario

LAB_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def log() -> Logger:
    """Return a bound logger for tests, with no global configuration."""
    return get_logger(app_name="test")


@pytest.fixture(scope="session")
def scenario_path() -> Path:
    """Return the path of the scenario file the lab ships."""
    return LAB_ROOT / "scenario.yaml"


@pytest.fixture(scope="session")
def scenario(scenario_path: Path, log: Logger) -> Scenario:
    """Load the shipped 30-name scenario."""
    return load_scenario(scenario_path, log=log)


@pytest.fixture(scope="session")
def universe(scenario: Scenario) -> Universe:
    """Return the shipped universe."""
    return scenario.universe


@pytest.fixture(scope="session")
def generator_settings(scenario: Scenario) -> GeneratorSettings:
    """Return the shipped generator settings."""
    return scenario.market


@pytest.fixture
def tiny_returns() -> FloatArray:
    """Return a hand-checkable two-asset, four-scenario return matrix."""
    return np.array(
        [[0.10, -0.20], [-0.05, 0.04], [0.02, 0.02], [-0.08, -0.06]],
        dtype=np.float64,
    )
