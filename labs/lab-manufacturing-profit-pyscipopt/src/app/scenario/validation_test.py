"""Exact-path tests for coefficient domains and array relationships."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml

from app.errors import ScenarioError
from app.logging_setup import Logger, get_logger
from app.scenario import load_scenario

LAB_ROOT = Path(__file__).parents[3]
DEFAULT_SCENARIO = LAB_ROOT / "scenario.yaml"


@pytest.fixture
def log() -> Logger:
    return get_logger(test="validation")


def _data() -> dict[str, Any]:
    loaded = yaml.safe_load(DEFAULT_SCENARIO.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _set(data: dict[str, Any], keys: tuple[str, ...], value: object) -> None:
    target = data
    for key in keys[:-1]:
        child = target[key]
        assert isinstance(child, dict)
        target = child
    target[keys[-1]] = value


def _write(tmp_path: Path, data: dict[str, Any]) -> Path:
    path = tmp_path / "scenario.yaml"
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return path


@pytest.mark.parametrize(
    ("keys", "value", "field"),
    [
        (
            ("staff", "us", "rd", "minimum", "year_1"),
            -1,
            "scenario.staff.us.rd.minimum.year_1",
        ),
        (
            ("staff", "us", "rd", "maximum", "year_1"),
            2.5,
            "scenario.staff.us.rd.maximum.year_1",
        ),
        (
            ("support", "fixed_headcount", "us", "year_1"),
            -1,
            "scenario.support.fixed_headcount.us.year_1",
        ),
        (
            ("support", "coverage_ratios", "us", "rd", "year_1"),
            -1,
            "scenario.support.coverage_ratios.us.rd.year_1",
        ),
        (
            ("regional_budget_musd", "us", "year_1"),
            0,
            "scenario.regional_budget_musd.us.year_1",
        ),
        (
            ("office_overhead_musd", "us", "year_1"),
            -1,
            "scenario.office_overhead_musd.us.year_1",
        ),
        (
            ("investments", "us_rd_upgrade", "cost_musd"),
            -1,
            "scenario.investments.us_rd_upgrade.cost_musd",
        ),
        (
            ("central_allowance_musd", "year_1"),
            -1,
            "scenario.central_allowance_musd.year_1",
        ),
        (
            ("research", "regions", "us", "alpha", "year_1"),
            0,
            "scenario.research.regions.us.alpha.year_1",
        ),
        (
            ("research", "regions", "us", "beta", "year_1"),
            0,
            "scenario.research.regions.us.beta.year_1",
        ),
        (
            ("research", "regions", "us", "upgrade_alpha_gain"),
            -1,
            "scenario.research.regions.us.upgrade_alpha_gain",
        ),
        (
            ("knowledge", "process_conversion", "year_1"),
            -1,
            "scenario.knowledge.process_conversion.year_1",
        ),
        (
            ("knowledge", "material_saving_floor"),
            0,
            "scenario.knowledge.material_saving_floor",
        ),
        (
            ("knowledge", "maintenance_required", "year_1"),
            -1,
            "scenario.knowledge.maintenance_required.year_1",
        ),
        (
            ("factories", "capacity", "germany", "year_1"),
            0,
            "scenario.factories.capacity.germany.year_1",
        ),
        (
            ("factories", "germany_capacity_gain", "year_1"),
            -1,
            "scenario.factories.germany_capacity_gain.year_1",
        ),
        (
            ("factories", "manufacturing_productivity", "germany", "year_1"),
            0,
            "scenario.factories.manufacturing_productivity.germany.year_1",
        ),
        (
            ("factories", "manufacturing_effort", "germany", "standard"),
            0,
            "scenario.factories.manufacturing_effort.germany.standard",
        ),
        (
            ("materials", "requirement_per_unit", "germany", "standard"),
            0,
            "scenario.materials.requirement_per_unit.germany.standard",
        ),
        (
            ("materials", "price_musd_per_material", "germany", "year_1"),
            -1,
            "scenario.materials.price_musd_per_material.germany.year_1",
        ),
        (
            ("electricity", "baseline", "germany", "year_1"),
            -1,
            "scenario.electricity.baseline.germany.year_1",
        ),
        (
            ("factories", "overhead_musd", "germany", "year_1"),
            -1,
            "scenario.factories.overhead_musd.germany.year_1",
        ),
        (
            ("shipping_cost_musd_per_unit", "germany", "us", "standard"),
            -1,
            "scenario.shipping_cost_musd_per_unit.germany.us.standard",
        ),
        (
            ("market", "demand_base", "us", "standard", "year_1"),
            -1,
            "scenario.market.demand_base.us.standard.year_1",
        ),
        (
            ("market", "reference_price_musd_per_unit", "us", "standard", "year_1"),
            0,
            "scenario.market.reference_price_musd_per_unit.us.standard.year_1",
        ),
        (
            ("market", "price_max_musd_per_unit", "us", "standard", "year_1"),
            0.5,
            "scenario.market.price_max_musd_per_unit.us.standard.year_1",
        ),
        (
            ("market", "price_sensitivity", "us", "standard", "year_1"),
            -1,
            "scenario.market.price_sensitivity.us.standard.year_1",
        ),
        (
            ("market", "sales_alpha", "us", "year_1"),
            -1,
            "scenario.market.sales_alpha.us.year_1",
        ),
    ],
)
def test_rejects_unsafe_coefficient_with_exact_path(
    tmp_path: Path,
    log: Logger,
    keys: tuple[str, ...],
    value: object,
    field: str,
) -> None:
    data = _data()
    _set(data, keys, value)

    with pytest.raises(ScenarioError, match=field.replace(".", r"\.")):
        load_scenario(_write(tmp_path, data), log=log)


@pytest.mark.parametrize(
    ("keys", "value"),
    [
        (("support", "fixed_headcount", "us", "year_1"), 0),
        (("support", "coverage_ratios", "us", "rd", "year_1"), 0),
        (("office_overhead_musd", "us", "year_1"), 0),
        (("investments", "us_rd_upgrade", "cost_musd"), 0),
        (("central_allowance_musd", "year_1"), 0),
        (("research", "regions", "us", "upgrade_alpha_gain"), 0),
        (("knowledge", "process_conversion", "year_1"), 0),
        (("knowledge", "maintenance_required", "year_1"), 0),
        (("factories", "germany_capacity_gain", "year_1"), 0),
        (("materials", "price_musd_per_material", "germany", "year_1"), 0),
        (("electricity", "baseline", "germany", "year_1"), 0),
        (("factories", "overhead_musd", "germany", "year_1"), 0),
        (("shipping_cost_musd_per_unit", "germany", "us", "standard"), 0),
        (("market", "price_sensitivity", "us", "standard", "year_1"), 0),
        (("market", "sales_alpha", "us", "year_1"), 0),
        (
            ("electricity", "tariffs", "germany", "marginal_rates_musd"),
            [0, 0.008, 0.012],
        ),
    ],
)
def test_accepts_zero_for_optional_effect_or_cost(
    tmp_path: Path,
    log: Logger,
    keys: tuple[str, ...],
    value: object,
) -> None:
    data = deepcopy(_data())
    _set(data, keys, value)

    load_scenario(_write(tmp_path, data), log=log)


def test_rejects_negative_electricity_per_unit_with_exact_path(
    tmp_path: Path, log: Logger
) -> None:
    data = _data()
    _set(data, ("electricity", "per_unit", "germany", "standard"), -1)
    _set(data, ("electricity", "per_unit", "germany", "high_performance"), -1)

    with pytest.raises(
        ScenarioError,
        match=r"scenario\.electricity\.per_unit\.germany\.standard",
    ):
        load_scenario(_write(tmp_path, data), log=log)


@pytest.mark.parametrize(
    ("keys", "value", "field"),
    [
        (
            ("factories", "manufacturing_effort", "germany", "high_performance"),
            1.1,
            "scenario.factories.manufacturing_effort.germany.high_performance",
        ),
        (
            ("materials", "requirement_per_unit", "germany", "high_performance"),
            2.6,
            "scenario.materials.requirement_per_unit.germany.high_performance",
        ),
        (
            ("electricity", "per_unit", "germany", "high_performance"),
            2.1,
            "scenario.electricity.per_unit.germany.high_performance",
        ),
        (
            ("market", "demand_base", "us", "high_performance", "year_2"),
            84,
            "scenario.market.demand_base.us.high_performance.year_2",
        ),
    ],
)
def test_rejects_cross_array_relationship_with_exact_path(
    tmp_path: Path,
    log: Logger,
    keys: tuple[str, ...],
    value: object,
    field: str,
) -> None:
    data = _data()
    _set(data, keys, value)

    with pytest.raises(ScenarioError, match=field.replace(".", r"\.")):
        load_scenario(_write(tmp_path, data), log=log)


def test_unaffordable_factory_needs_no_unreachable_tariff_coverage(
    tmp_path: Path, log: Logger
) -> None:
    data = _data()
    _set(data, ("investments", "china_factory", "cost_musd"), 1000)
    _set(data, ("electricity", "tariffs", "china", "thresholds"), [0, 1, 2, 3])

    load_scenario(_write(tmp_path, data), log=log)


def test_zero_per_unit_electricity_disables_variable_energy(
    tmp_path: Path, log: Logger
) -> None:
    data = _data()
    _set(data, ("electricity", "per_unit", "germany", "standard"), 0)
    _set(data, ("electricity", "per_unit", "germany", "high_performance"), 0)

    load_scenario(_write(tmp_path, data), log=log)
