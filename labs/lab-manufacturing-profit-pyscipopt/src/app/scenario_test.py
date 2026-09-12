"""Behavior tests for the explicit three-year YAML scenario contract."""

from __future__ import annotations

from dataclasses import replace
from hashlib import sha256
from pathlib import Path

import numpy as np
import pytest

from app.errors import ScenarioError
from app.logging_setup import Logger
from app.scenario import Scenario, load_scenario, validate_scenario

VALID_YAML = """\
product:
  selling_price_usd_per_unit: 90
  demand_units:
    year_1: 4000
    year_2: 6000
    year_3: 6000
manufacturing:
  initial_unit_cost_usd: 50
  minimum_unit_cost_usd: 25
  units_per_worker_per_year: 1000
  worker_salary_usd_per_year: 20000
  max_workers: 6
  capacity_units_per_year: 4000
research:
  researcher_salary_usd_per_year: 10000
  max_researchers: 3
  first_researcher_saving_usd_per_unit: 4
  saving_drop_per_additional_researcher: 1
expansion:
  cost_usd: 50000
  extra_capacity_units_per_year: 2000
solver:
  time_limit_seconds: 120
  relative_gap: 0.01
"""


def _load_text(tmp_path: Path, text: str, log: Logger) -> Scenario:
    """Write one controlled YAML document and load it through the public API."""
    path = tmp_path / "scenario.yaml"
    path.write_text(text, encoding="utf-8")
    return load_scenario(path, log=log)


def _override_untyped(scenario: Scenario, field: str, value: object) -> Scenario:
    """Create an invalid runtime override that static typing correctly forbids."""
    candidate = replace(scenario)
    object.__setattr__(candidate, field, value)
    return candidate


def test_loads_explicit_fields_in_year_order(tmp_path: Path, log: Logger) -> None:
    """A valid document maps named YAML leaves to typed, ordered values."""
    scenario = _load_text(tmp_path, VALID_YAML, log)

    assert scenario.selling_price_usd_per_unit == 90.0
    np.testing.assert_array_equal(scenario.demand_units, [4000, 6000, 6000])
    assert scenario.expansion_cost_usd == 50000.0
    assert scenario.solver.relative_gap == 0.01
    assert scenario.input_sha256 == sha256(VALID_YAML.encode()).hexdigest()
    assert not scenario.demand_units.flags.writeable


@pytest.mark.parametrize(
    "text",
    [
        VALID_YAML + "unexpected: 1\n",
        VALID_YAML.replace(
            "  relative_gap: 0.01\n", "  relative_gap: 0.01\n  typo: 1\n"
        ),
    ],
)
def test_rejects_unknown_root_or_nested_keys(
    tmp_path: Path, log: Logger, text: str
) -> None:
    """Misspelled or obsolete keys cannot silently leave defaults in effect."""
    with pytest.raises(ScenarioError):
        _load_text(tmp_path, text, log)


def test_rejects_missing_demand_year(tmp_path: Path, log: Logger) -> None:
    """Demand must name each year so array ordering cannot hide a missing value."""
    text = VALID_YAML.replace("    year_2: 6000\n", "")
    with pytest.raises(ScenarioError):
        _load_text(tmp_path, text, log)


@pytest.mark.parametrize(
    "text",
    [
        "product: [\n",
        "null\n",
        VALID_YAML.replace("  max_workers: 6\n", '  max_workers: "6"\n'),
        VALID_YAML.replace("  max_workers: 6\n", "  max_workers: null\n"),
        VALID_YAML.replace("  max_workers: 6\n", "  max_workers: [6]\n"),
        VALID_YAML.replace(
            "  initial_unit_cost_usd: 50\n", "  initial_unit_cost_usd: .inf\n"
        ),
        VALID_YAML.replace("    year_1: 4000\n", "    year_1: -1\n"),
        VALID_YAML.replace(
            "  selling_price_usd_per_unit: 90\n", "  selling_price_usd_per_unit: {}\n"
        ),
        VALID_YAML.replace(
            "  demand_units:\n    year_1: 4000\n    year_2: 6000\n    year_3: 6000\n",
            "  demand_units: 4000\n",
        ),
    ],
)
def test_rejects_malformed_or_wrongly_typed_yaml(
    tmp_path: Path, log: Logger, text: str
) -> None:
    """Malformed documents and nonnumeric business leaves fail before modeling."""
    with pytest.raises(ScenarioError):
        _load_text(tmp_path, text, log)


def test_rejects_invalid_utf8(tmp_path: Path, log: Logger) -> None:
    """Source bytes must decode as UTF-8 before YAML parsing."""
    path = tmp_path / "scenario.yaml"
    path.write_bytes(b"\xff")
    with pytest.raises(ScenarioError):
        load_scenario(path, log=log)


def test_rejects_unreadable_source(tmp_path: Path, log: Logger) -> None:
    """Filesystem read failures surface as a scenario-domain error."""
    with pytest.raises(ScenarioError):
        load_scenario(tmp_path / "missing.yaml", log=log)


def test_revalidates_values_after_overrides(scenario: Scenario) -> None:
    """Programmatic overrides receive the same shape and scalar validation as YAML."""
    invalid = (
        _override_untyped(scenario, "max_workers", True),
        _override_untyped(scenario, "max_workers", 1.5),
        replace(scenario, initial_unit_cost_usd=float("nan")),
        replace(scenario, minimum_unit_cost_usd=51.0),
        replace(scenario, max_researchers=6),
        replace(scenario, demand_units=np.array([1.0, 2.0])),
    )
    for candidate in invalid:
        with pytest.raises(ScenarioError):
            validate_scenario(candidate)

    with pytest.raises(ScenarioError):
        validate_scenario(
            replace(scenario, solver=replace(scenario.solver, relative_gap=1.0))
        )


def test_accepts_zero_demand_and_staff_limits(scenario: Scenario) -> None:
    """A shutdown scenario may have no demand and prohibit both staff types."""
    candidate = replace(
        scenario,
        demand_units=np.zeros(3, dtype=np.float64),
        max_workers=0,
        max_researchers=0,
    )
    validate_scenario(candidate)


def test_accepts_zero_last_researcher_saving(scenario: Scenario) -> None:
    """The largest allowed research team may have zero marginal saving."""
    candidate = replace(scenario, max_researchers=5)
    validate_scenario(candidate)
