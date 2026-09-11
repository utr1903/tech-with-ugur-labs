"""Shared fixtures for the flat three-year planning modules."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.logging_setup import Logger, get_logger
from app.scenario import Scenario, load_scenario


@pytest.fixture
def log() -> Logger:
    """Return an unconfigured logger suitable for isolated unit tests."""
    return get_logger()


@pytest.fixture
def scenario(log: Logger) -> Scenario:
    """Load the lab's documented default scenario for tests that refine it."""
    lab_root = Path(__file__).resolve().parents[2]
    return load_scenario(lab_root / "scenario.yaml", log=log)
