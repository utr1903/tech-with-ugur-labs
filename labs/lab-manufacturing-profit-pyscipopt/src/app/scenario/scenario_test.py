"""Behavior tests for loading and validating the editable scenario."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import yaml

from app.errors import ScenarioError
from app.logging_setup import Logger, get_logger
from app.scenario import derive_bounds, load_scenario

LAB_ROOT = Path(__file__).parents[3]
DEFAULT_SCENARIO = LAB_ROOT / "scenario.yaml"


@pytest.fixture
def log() -> Logger:
    """Return a typed logger without configuring global output."""
    return get_logger(test="scenario")


def _default_data() -> dict[str, Any]:
    loaded = yaml.safe_load(DEFAULT_SCENARIO.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _write(tmp_path: Path, data: dict[str, Any]) -> Path:
    path = tmp_path / "scenario.yaml"
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return path


def _changed(tmp_path: Path, keys: tuple[str, ...], value: object) -> Path:
    data = deepcopy(_default_data())
    target: dict[str, Any] = data
    for key in keys[:-1]:
        child = target[key]
        assert isinstance(child, dict)
        target = child
    target[keys[-1]] = value
    return _write(tmp_path, data)


def test_load_scenario_freezes_named_axes(tmp_path: Path, log: Logger) -> None:
    path = _changed(
        tmp_path,
        ("staff", "us", "rd", "salary_musd_per_person", "year_1"),
        0.3,
    )

    scenario = load_scenario(path, log=log)

    us = scenario.axes.regions.index("us")
    rd = scenario.axes.teams.index("rd")
    assert scenario.salary.shape == (4, 4, 3)
    assert scenario.salary[us, rd, 0] == pytest.approx(0.3)
    assert not scenario.salary.flags.writeable
    assert scenario.axis_index(scenario.axes.regions)["germany"] == 2
    for value in vars(scenario).values():
        if isinstance(value, np.ndarray):
            assert np.isfinite(value).all()
            assert not value.flags.writeable


@pytest.mark.parametrize(
    ("keys", "value", "field"),
    [
        (("solver", "unexpected"), 1.0, "scenario.solver.unexpected"),
        (("staff", "brazil"), {}, "scenario.staff.brazil"),
        (
            ("staff", "us", "rd", "minimum"),
            {"year_1": 1, "year_2": 1},
            "scenario.staff.us.rd.minimum.year_3",
        ),
        (
            ("staff", "us", "rd", "minimum", "year_2"),
            True,
            "scenario.staff.us.rd.minimum.year_2",
        ),
        (
            ("staff", "us", "rd", "minimum", "year_2"),
            float("nan"),
            "scenario.staff.us.rd.minimum.year_2",
        ),
        (
            ("staff", "us", "rd", "minimum", "year_2"),
            float("inf"),
            "scenario.staff.us.rd.minimum.year_2",
        ),
        (
            ("staff", "us", "rd", "minimum", "year_2"),
            99,
            "scenario.staff.us.rd.minimum.year_2",
        ),
        (
            ("solver", "time_limit_seconds"),
            0,
            "scenario.solver.time_limit_seconds",
        ),
        (
            ("staff", "us", "manufacturing", "maximum", "year_1"),
            1,
            "scenario.staff.us.manufacturing.maximum.year_1",
        ),
        (
            ("electricity", "tariffs", "germany", "thresholds"),
            [0, 250, 200, 900],
            "scenario.electricity.tariffs.germany.thresholds",
        ),
        (
            ("electricity", "tariffs", "germany", "marginal_rates_musd"),
            [0.02, 0.02, 0.04],
            "scenario.electricity.tariffs.germany.marginal_rates_musd",
        ),
        (
            ("electricity", "tariffs", "germany", "thresholds"),
            [0, 100, 200, 250],
            "scenario.electricity.tariffs.germany.thresholds",
        ),
        (
            ("electricity", "tariffs", "germany", "thresholds"),
            [0, 100, 500],
            "scenario.electricity.tariffs.germany.thresholds",
        ),
        (
            ("knowledge", "max_process_saving"),
            0.95,
            "scenario.knowledge.max_process_saving",
        ),
        (
            ("market", "demand_base", "us", "standard", "year_1"),
            1,
            "scenario.market.demand_base.us.standard.year_1",
        ),
        (
            ("research", "regions", "us", "beta", "year_1"),
            10,
            "scenario.research.regions.us.beta.year_1",
        ),
        (
            ("research", "regions", "us", "alpha", "year_2"),
            True,
            "scenario.research.regions.us.alpha.year_2",
        ),
        (
            ("market", "sales_beta", "us", "year_1"),
            0,
            "scenario.market.sales_beta.us.year_1",
        ),
    ],
    ids=[
        "unknown-key",
        "wrong-axis-member",
        "missing-shape-member",
        "boolean-number",
        "nan",
        "infinity",
        "minimum-over-maximum",
        "nonpositive-bound",
        "disallowed-team",
        "unordered-thresholds",
        "unordered-rates",
        "uncovered-energy",
        "tariff-block-shape",
        "material-floor",
        "negative-demand-minimum",
        "negative-rd-output",
        "research-field-path",
        "zero-sales-curvature",
    ],
)
def test_invalid_scenario_names_offending_field(
    tmp_path: Path,
    log: Logger,
    keys: tuple[str, ...],
    value: object,
    field: str,
) -> None:
    path = _changed(tmp_path, keys, value)

    with pytest.raises(ScenarioError, match=field.replace(".", r"\.")):
        load_scenario(path, log=log)


def test_missing_required_key_names_field(tmp_path: Path, log: Logger) -> None:
    data = _default_data()
    del data["solver"]["relative_gap"]

    with pytest.raises(ScenarioError, match=r"scenario\.solver\.relative_gap"):
        load_scenario(_write(tmp_path, data), log=log)


def test_safe_loader_rejects_python_object(tmp_path: Path, log: Logger) -> None:
    path = tmp_path / "unsafe.yaml"
    path.write_text("!!python/object:builtins.object {}\n", encoding="utf-8")

    with pytest.raises(ScenarioError, match=r"scenario"):
        load_scenario(path, log=log)


def test_derived_bounds_are_finite_and_read_only(log: Logger) -> None:
    scenario = load_scenario(DEFAULT_SCENARIO, log=log)

    bounds = derive_bounds(scenario)

    assert bounds.production_max.shape == (2, 3)
    assert bounds.high_production_max.shape == (3,)
    assert bounds.demand_max.shape == (4, 2, 3)
    assert bounds.electricity_max.shape == (2, 3)
    assert bounds.cash_abs_max > 0
    for value in vars(bounds).values():
        if isinstance(value, np.ndarray):
            assert np.isfinite(value).all()
            assert not value.flags.writeable
