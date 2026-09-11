"""Conversion of factory, material, energy, and shipping coefficients."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.contracts import Axes, FloatArray, Tariff
from app.errors import ScenarioError
from app.scenario.parsing import require_keys, tensor, vector
from app.scenario.sections import ScenarioSections


@dataclass(frozen=True)
class OperationsData:
    """Immutable operating coefficients."""

    factory_capacity: FloatArray
    germany_capacity_gain: FloatArray
    manufacturing_productivity: FloatArray
    manufacturing_effort: FloatArray
    material_requirement: FloatArray
    material_price: FloatArray
    factory_baseline_electricity: FloatArray
    electricity_per_unit: FloatArray
    factory_overhead: FloatArray
    tariff: Tariff
    shipping_cost: FloatArray


def _tariff(sections: ScenarioSections, axes: Axes) -> Tariff:
    path = "scenario.electricity.tariffs"
    tariffs = require_keys(sections.electricity["tariffs"], axes.factories, path)
    threshold_rows = []
    rate_rows = []
    for factory in axes.factories:
        factory_path = f"{path}.{factory}"
        row = require_keys(
            tariffs[factory], ("thresholds", "marginal_rates_musd"), factory_path
        )
        thresholds = vector(row["thresholds"], f"{factory_path}.thresholds")
        rates = vector(
            row["marginal_rates_musd"], f"{factory_path}.marginal_rates_musd"
        )
        if len(thresholds) != len(rates) + 1:
            raise ScenarioError(
                f"{factory_path}.thresholds: must have block count plus one"
            )
        threshold_rows.append(thresholds)
        rate_rows.append(rates)
    try:
        thresholds = np.array(threshold_rows, dtype=np.float64, copy=True)
        rates = np.array(rate_rows, dtype=np.float64, copy=True)
    except ValueError as err:
        raise ScenarioError(
            f"{path}: every factory must use the same block shape"
        ) from err
    thresholds.flags.writeable = False
    rates.flags.writeable = False
    return Tariff(thresholds=thresholds, marginal_rates=rates)


def convert_operations(sections: ScenarioSections, axes: Axes) -> OperationsData:
    """Convert operations mappings in canonical axis order."""
    years = tuple(f"year_{year}" for year in axes.years)
    factory_year = (axes.factories, years)
    factory_product = (axes.factories, axes.products)
    return OperationsData(
        factory_capacity=tensor(
            sections.factories["capacity"],
            "scenario.factories.capacity",
            factory_year,
        ),
        germany_capacity_gain=tensor(
            sections.factories["germany_capacity_gain"],
            "scenario.factories.germany_capacity_gain",
            (years,),
        ),
        manufacturing_productivity=tensor(
            sections.factories["manufacturing_productivity"],
            "scenario.factories.manufacturing_productivity",
            factory_year,
        ),
        manufacturing_effort=tensor(
            sections.factories["manufacturing_effort"],
            "scenario.factories.manufacturing_effort",
            factory_product,
        ),
        material_requirement=tensor(
            sections.materials["requirement_per_unit"],
            "scenario.materials.requirement_per_unit",
            factory_product,
        ),
        material_price=tensor(
            sections.materials["price_musd_per_material"],
            "scenario.materials.price_musd_per_material",
            factory_year,
        ),
        factory_baseline_electricity=tensor(
            sections.electricity["baseline"],
            "scenario.electricity.baseline",
            factory_year,
        ),
        electricity_per_unit=tensor(
            sections.electricity["per_unit"],
            "scenario.electricity.per_unit",
            factory_product,
        ),
        factory_overhead=tensor(
            sections.factories["overhead_musd"],
            "scenario.factories.overhead_musd",
            factory_year,
        ),
        tariff=_tariff(sections, axes),
        shipping_cost=tensor(
            sections.root["shipping_cost_musd_per_unit"],
            "scenario.shipping_cost_musd_per_unit",
            (axes.factories, axes.markets, axes.products),
        ),
    )
