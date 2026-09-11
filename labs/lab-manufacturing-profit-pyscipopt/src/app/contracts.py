"""Immutable data exchanged by scenario, model, verification, and reporting."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

import numpy as np
import numpy.typing as npt

type FloatArray = npt.NDArray[np.float64]
type IntArray = npt.NDArray[np.int64]
type ObjectArray = npt.NDArray[np.object_]


def axis_index(names: tuple[str, ...]) -> Mapping[str, int]:
    """Return an immutable name-to-position map for an axis."""
    return MappingProxyType({name: position for position, name in enumerate(names)})


@dataclass(frozen=True)
class Axes:
    """Canonical orders used by every scenario array."""

    regions: tuple[str, ...] = ("us", "india", "germany", "china")
    factories: tuple[str, ...] = ("germany", "china")
    markets: tuple[str, ...] = ("us", "india", "germany", "china")
    products: tuple[str, ...] = ("standard", "high_performance")
    years: tuple[int, ...] = (1, 2, 3)
    teams: tuple[str, ...] = ("rd", "manufacturing", "sales", "support")
    investments: tuple[str, ...] = (
        "us_rd_upgrade",
        "india_rd_upgrade",
        "germany_capacity_upgrade",
        "china_factory",
    )
    rd_uses: tuple[str, ...] = ("process", "development", "maintenance")


@dataclass(frozen=True)
class SolverSettings:
    """Solver and independent-verification tolerances."""

    time_limit_seconds: float
    relative_gap: float
    feasibility_abs: float
    feasibility_rel: float
    integrality_abs: float


@dataclass(frozen=True)
class Tariff:
    """Increasing marginal electricity blocks by factory."""

    thresholds: FloatArray
    marginal_rates: FloatArray


@dataclass(frozen=True)
class Scenario:
    """One complete, validated planning scenario in canonical axis order."""

    axes: Axes
    solver: SolverSettings
    staff_min: FloatArray
    staff_max: FloatArray
    salary: FloatArray
    support_fixed: FloatArray
    support_ratios: FloatArray
    regional_budget: FloatArray
    office_overhead: FloatArray
    investment_cost: FloatArray
    central_allowance: FloatArray
    rd_alpha: FloatArray
    rd_beta: FloatArray
    rd_upgrade_alpha_gain: FloatArray
    process_conversion: FloatArray
    initial_process_saving: float
    max_process_saving: float
    material_saving_floor: float
    initial_development_stock: float
    max_development_stock: float
    development_threshold: float
    maintenance_required: FloatArray
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
    demand_base: FloatArray
    reference_price: FloatArray
    price_min: FloatArray
    price_max: FloatArray
    price_sensitivity: FloatArray
    sales_alpha: FloatArray
    sales_beta: FloatArray

    @staticmethod
    def axis_index(names: tuple[str, ...]) -> Mapping[str, int]:
        """Expose an immutable name-to-position map for any scenario axis."""
        return axis_index(names)


@dataclass(frozen=True)
class DecisionValues:
    """Values extracted from a solver incumbent."""

    headcount: FloatArray
    investment_start: FloatArray
    rd_allocation: FloatArray
    process_saving: FloatArray
    development_stock: FloatArray
    product_active: FloatArray
    sales_share: FloatArray
    price: FloatArray
    sales: FloatArray
    production: FloatArray
    shipment: FloatArray
    electricity_use: FloatArray
    electricity_cost: FloatArray
    cash_auxiliary: float


@dataclass(frozen=True)
class SolveMetadata:
    """Status and measured size of one solve."""

    status: str
    has_incumbent: bool
    solve_seconds: float
    objective_bound: float | None
    relative_gap: float | None
    node_count: int
    variable_count: int
    constraint_count: int
    scip_version: str


@dataclass(frozen=True)
class SolveResult:
    """Solver metadata plus optional feasible decisions."""

    metadata: SolveMetadata
    decisions: DecisionValues | None


@dataclass(frozen=True)
class DerivedBounds:
    """Finite bounds derived from scenario data for model variables."""

    production_max: FloatArray
    high_production_max: FloatArray
    demand_max: FloatArray
    electricity_max: FloatArray
    cash_abs_max: float
