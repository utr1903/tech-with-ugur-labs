"""Load and validate the explicit three-year manufacturing scenario."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from hashlib import sha256
from math import isfinite
from pathlib import Path

import numpy as np
import yaml
from numpy.typing import NDArray

from app.errors import ScenarioError
from app.logging_setup import Logger

type FloatArray = NDArray[np.float64]

_ROOT_KEYS = {"product", "manufacturing", "research", "expansion", "solver"}
_PRODUCT_KEYS = {"selling_price_usd_per_unit", "demand_units"}
_DEMAND_KEYS = {"year_1", "year_2", "year_3"}
_MANUFACTURING_KEYS = {
    "initial_unit_cost_usd",
    "minimum_unit_cost_usd",
    "units_per_worker_per_year",
    "worker_salary_usd_per_year",
    "max_workers",
    "capacity_units_per_year",
}
_RESEARCH_KEYS = {
    "researcher_salary_usd_per_year",
    "max_researchers",
    "first_researcher_saving_usd_per_unit",
    "saving_drop_per_additional_researcher",
}
_EXPANSION_KEYS = {"cost_usd", "extra_capacity_units_per_year"}
_SOLVER_KEYS = {"time_limit_seconds", "relative_gap"}


@dataclass(frozen=True)
class SolverSettings:
    """SCIP stopping limits: positive seconds and a relative gap in [0, 1)."""

    time_limit_seconds: float
    relative_gap: float


@dataclass(frozen=True)
class Scenario:
    """Validated business inputs in dollars, product units, people, and years.

    ``demand_units`` is copied into a read-only float64 array ordered year 1,
    year 2, year 3. Research hired in one year lowers ``unit_cost`` beginning
    the following year. ``expansion_cost_usd`` maps YAML ``expansion.cost_usd``
    and is paid once in the chosen start year. ``input_sha256`` identifies the
    exact source bytes, including comments and whitespace.
    """

    selling_price_usd_per_unit: float
    demand_units: FloatArray
    initial_unit_cost_usd: float
    minimum_unit_cost_usd: float
    units_per_worker_per_year: float
    worker_salary_usd_per_year: float
    max_workers: int
    capacity_units_per_year: float
    researcher_salary_usd_per_year: float
    max_researchers: int
    first_researcher_saving_usd_per_unit: float
    saving_drop_per_additional_researcher: float
    expansion_cost_usd: float
    extra_capacity_units_per_year: float
    solver: SolverSettings
    input_sha256: str

    def __post_init__(self) -> None:
        """Copy annual demand so callers cannot mutate a constructed scenario."""
        demand = np.array(self.demand_units, dtype=np.float64, copy=True)
        demand.setflags(write=False)
        object.__setattr__(self, "demand_units", demand)


def _mapping(value: object, name: str, keys: set[str]) -> Mapping[object, object]:
    """Return one mapping only when it contains exactly the documented keys."""
    if not isinstance(value, Mapping):
        raise ScenarioError(f"{name} must be a mapping")
    actual = set(value)
    missing = keys - actual
    unknown = actual - keys
    if missing or unknown:
        raise ScenarioError(
            f"{name} keys are invalid; missing={sorted(missing)!r}, "
            f"unknown={sorted(str(item) for item in unknown)!r}"
        )
    return value


def _number(value: object, name: str) -> float:
    """Convert a finite YAML integer or float to the model's float units."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ScenarioError(f"{name} must be a number")
    result = float(value)
    if not isfinite(result):
        raise ScenarioError(f"{name} must be finite")
    return result


def _integer(value: object, name: str) -> int:
    """Return a YAML integer headcount while rejecting booleans and fractions."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ScenarioError(f"{name} must be an integer")
    return value


def _value(section: Mapping[object, object], key: str) -> object:
    """Read a required leaf after its enclosing mapping passed exact-key checks."""
    return section[key]


def _parse_document(document: object, input_sha256: str) -> Scenario:
    """Transform exact YAML groups into the flat model-facing data contract."""
    root = _mapping(document, "scenario", _ROOT_KEYS)
    product = _mapping(_value(root, "product"), "product", _PRODUCT_KEYS)
    manufacturing = _mapping(
        _value(root, "manufacturing"), "manufacturing", _MANUFACTURING_KEYS
    )
    research = _mapping(_value(root, "research"), "research", _RESEARCH_KEYS)
    expansion = _mapping(_value(root, "expansion"), "expansion", _EXPANSION_KEYS)
    solver = _mapping(_value(root, "solver"), "solver", _SOLVER_KEYS)
    demand = _mapping(
        _value(product, "demand_units"), "product.demand_units", _DEMAND_KEYS
    )

    scenario = Scenario(
        selling_price_usd_per_unit=_number(
            _value(product, "selling_price_usd_per_unit"),
            "product.selling_price_usd_per_unit",
        ),
        demand_units=np.array(
            [
                _number(_value(demand, key), f"product.demand_units.{key}")
                for key in ("year_1", "year_2", "year_3")
            ],
            dtype=np.float64,
        ),
        initial_unit_cost_usd=_number(
            _value(manufacturing, "initial_unit_cost_usd"),
            "manufacturing.initial_unit_cost_usd",
        ),
        minimum_unit_cost_usd=_number(
            _value(manufacturing, "minimum_unit_cost_usd"),
            "manufacturing.minimum_unit_cost_usd",
        ),
        units_per_worker_per_year=_number(
            _value(manufacturing, "units_per_worker_per_year"),
            "manufacturing.units_per_worker_per_year",
        ),
        worker_salary_usd_per_year=_number(
            _value(manufacturing, "worker_salary_usd_per_year"),
            "manufacturing.worker_salary_usd_per_year",
        ),
        max_workers=_integer(
            _value(manufacturing, "max_workers"), "manufacturing.max_workers"
        ),
        capacity_units_per_year=_number(
            _value(manufacturing, "capacity_units_per_year"),
            "manufacturing.capacity_units_per_year",
        ),
        researcher_salary_usd_per_year=_number(
            _value(research, "researcher_salary_usd_per_year"),
            "research.researcher_salary_usd_per_year",
        ),
        max_researchers=_integer(
            _value(research, "max_researchers"), "research.max_researchers"
        ),
        first_researcher_saving_usd_per_unit=_number(
            _value(research, "first_researcher_saving_usd_per_unit"),
            "research.first_researcher_saving_usd_per_unit",
        ),
        saving_drop_per_additional_researcher=_number(
            _value(research, "saving_drop_per_additional_researcher"),
            "research.saving_drop_per_additional_researcher",
        ),
        expansion_cost_usd=_number(_value(expansion, "cost_usd"), "expansion.cost_usd"),
        extra_capacity_units_per_year=_number(
            _value(expansion, "extra_capacity_units_per_year"),
            "expansion.extra_capacity_units_per_year",
        ),
        solver=SolverSettings(
            time_limit_seconds=_number(
                _value(solver, "time_limit_seconds"), "solver.time_limit_seconds"
            ),
            relative_gap=_number(_value(solver, "relative_gap"), "solver.relative_gap"),
        ),
        input_sha256=input_sha256,
    )
    validate_scenario(scenario)
    return scenario


def _require_positive(name: str, value: object) -> None:
    """Require a scalar business rate, cost, capacity, or time to exceed zero."""
    if _number(value, name) <= 0:
        raise ScenarioError(f"{name} must be greater than zero")


def _require_headcount(name: str, value: object) -> None:
    """Require a configured staffing maximum to be a nonnegative integer."""
    if _integer(value, name) < 0:
        raise ScenarioError(f"{name} must be nonnegative")


def validate_solver_settings(settings: SolverSettings) -> None:
    """Validate positive solve seconds and a finite relative gap in ``[0, 1)``.

    This public check is shared by full-scenario validation and solve-time CLI
    overrides so both paths enforce the same units and admissible values.

    Raises:
        ScenarioError: If either solver setting is boolean, nonnumeric,
            non-finite, or outside its allowed range.
    """
    _require_positive("solver.time_limit_seconds", settings.time_limit_seconds)
    gap = _number(settings.relative_gap, "solver.relative_gap")
    if not 0 <= gap < 1:
        raise ScenarioError("solver.relative_gap must be in [0, 1)")


def validate_scenario(scenario: Scenario) -> None:
    """Validate all model inputs, including values changed after YAML loading.

    Demand must be a finite, nonnegative float array of shape ``(3,)`` in
    year order. Dollar rates, productivity, capacity, expansion size, savings,
    and solve time are strictly positive. Staff maxima are nonnegative integers,
    the cost floor cannot exceed the initial unit cost, the relative gap is in
    ``[0, 1)``, and every permitted researcher's marginal saving is nonnegative.

    Raises:
        ScenarioError: If any value cannot form the bounded three-year model.
    """
    demand = scenario.demand_units
    if not isinstance(demand, np.ndarray) or demand.shape != (3,):
        raise ScenarioError("demand_units must be a NumPy array with shape (3,)")
    if not np.issubdtype(demand.dtype, np.number) or not np.all(np.isfinite(demand)):
        raise ScenarioError("demand_units must contain finite numbers")
    if np.any(demand < 0):
        raise ScenarioError("demand_units must be nonnegative")

    positive_values = {
        "selling_price_usd_per_unit": scenario.selling_price_usd_per_unit,
        "initial_unit_cost_usd": scenario.initial_unit_cost_usd,
        "minimum_unit_cost_usd": scenario.minimum_unit_cost_usd,
        "units_per_worker_per_year": scenario.units_per_worker_per_year,
        "worker_salary_usd_per_year": scenario.worker_salary_usd_per_year,
        "capacity_units_per_year": scenario.capacity_units_per_year,
        "researcher_salary_usd_per_year": scenario.researcher_salary_usd_per_year,
        "first_researcher_saving_usd_per_unit": (
            scenario.first_researcher_saving_usd_per_unit
        ),
        "saving_drop_per_additional_researcher": (
            scenario.saving_drop_per_additional_researcher
        ),
        "expansion_cost_usd": scenario.expansion_cost_usd,
        "extra_capacity_units_per_year": scenario.extra_capacity_units_per_year,
    }
    for name, value in positive_values.items():
        _require_positive(name, value)
    _require_headcount("max_workers", scenario.max_workers)
    _require_headcount("max_researchers", scenario.max_researchers)
    validate_solver_settings(scenario.solver)

    if scenario.minimum_unit_cost_usd > scenario.initial_unit_cost_usd:
        raise ScenarioError("minimum_unit_cost_usd cannot exceed initial_unit_cost_usd")
    if scenario.max_researchers > 0:
        last_saving = scenario.first_researcher_saving_usd_per_unit - (
            scenario.saving_drop_per_additional_researcher
            * (scenario.max_researchers - 1)
        )
        if last_saving < 0:
            raise ScenarioError(
                "max_researchers allows a negative marginal research saving"
            )


def load_scenario(path: Path, *, log: Logger) -> Scenario:
    """Read, hash, parse, and validate one UTF-8 YAML scenario.

    The file is read once as bytes. Those exact bytes produce ``input_sha256``
    and are decoded for ``yaml.safe_load``. YAML groups become one flat
    :class:`Scenario`; annual demand becomes a read-only float64 array ordered
    year 1 through year 3. The operation emits structured entry, success, and
    failure logs.

    Args:
        path: YAML source path.
        log: Logger receiving operation metadata.

    Returns:
        A validated immutable scenario whose scalar units follow each field name.

    Raises:
        ScenarioError: If the file cannot be read or decoded, YAML cannot be
            parsed, keys/types are wrong, or business bounds are invalid.
    """
    log.info("Loading scenario...", path=str(path))
    try:
        source = path.read_bytes()
        text = source.decode("utf-8")
        document = yaml.safe_load(text)
        scenario = _parse_document(document, sha256(source).hexdigest())
    except ScenarioError:
        log.exception("Loading scenario failed.", path=str(path))
        raise
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as err:
        log.exception("Loading scenario failed.", path=str(path))
        raise ScenarioError(f"Could not load scenario from {path}") from err
    else:
        log.info(
            "Loading scenario succeeded.",
            path=str(path),
            input_sha256=scenario.input_sha256,
        )
        return scenario
