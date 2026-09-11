"""Build the bounded three-year manufacturing cash model in equation order."""

from __future__ import annotations

from dataclasses import dataclass
from math import fsum, isfinite
from typing import Literal

import numpy as np
from pyscipopt import MatrixVariable, Model, Variable, quicksum

from app.errors import ModelError, ScenarioError
from app.logging_setup import Logger
from app.scenario import FloatArray, Scenario, validate_scenario

_YEARS = 3


@dataclass(frozen=True)
class DecisionValues:
    """Raw incumbent arrays in year 1–3 order, copied and kept unrounded.

    People and expansion values stay as solver floats so verification can detect
    integrality errors. Production is units/year and unit cost is USD/unit.
    """

    workers: FloatArray
    researchers: FloatArray
    expansion_start: FloatArray
    units_produced: FloatArray
    unit_cost: FloatArray

    def __post_init__(self) -> None:
        """Copy each extracted array so a reported incumbent cannot be mutated."""
        for name in (
            "workers",
            "researchers",
            "expansion_start",
            "units_produced",
            "unit_cost",
        ):
            values = np.array(getattr(self, name), dtype=np.float64, copy=True)
            values.setflags(write=False)
            object.__setattr__(self, name, values)


@dataclass(frozen=True)
class ModelVariables:
    """SCIP decision arrays in year 1–3 order and the scalar cash objective."""

    workers: MatrixVariable
    researchers: MatrixVariable
    expansion_start: MatrixVariable
    units_produced: MatrixVariable
    unit_cost: MatrixVariable
    cash_auxiliary: Variable


@dataclass(frozen=True)
class BuiltModel:
    """A configured SCIP model paired with the variables used after solving."""

    model: Model
    variables: ModelVariables


@dataclass(frozen=True)
class SolveResult:
    """Solver outcome with optional incumbent values and finite metadata.

    ``objective_usd`` is SCIP's auxiliary value, not recomputed cash. With no
    incumbent, decisions/objective/gap are ``None``. SCIP-infinite bound or gap
    values also become ``None``; ``solve_seconds`` is elapsed solver time.
    """

    decisions: DecisionValues | None
    status: str
    objective_usd: float | None
    objective_bound_usd: float | None
    relative_gap: float | None
    solve_seconds: float


def build_model(scenario: Scenario, *, log: Logger) -> BuiltModel:
    """Validate inputs and build the complete model without optimizing it.

    ``scenario`` supplies dollars, units, people, and read-only annual demand in
    year 1–3 order. The returned hidden-output SCIP model contains the five
    decision arrays and cash auxiliary used by the solver.

    Raises:
        ScenarioError: If inputs, overrides, or derived finite bounds are invalid.
        ModelError: If SCIP rejects variable or constraint construction.
    """
    log.info("Building model...", years=_YEARS)
    try:
        validate_scenario(scenario)
        model = Model("manufacturing_profit")
        model.hideOutput()
        variables = _create_variables(model, scenario)
        add_capacity_constraints(model, variables, scenario, log=log)
        add_research_constraints(model, variables, scenario, log=log)
        add_cash_objective(model, variables, scenario, log=log)
    except (ModelError, ScenarioError):
        log.exception("Building model failed.", years=_YEARS)
        raise
    except Exception as err:
        log.exception("Building model failed.", years=_YEARS)
        raise ModelError("Could not build manufacturing model") from err
    else:
        log.info(
            "Building model succeeded.",
            variables=int(model.getNVars()),
            constraints=int(model.getNConss()),
        )
        return BuiltModel(model=model, variables=variables)


def add_capacity_constraints(
    model: Model,
    variables: ModelVariables,
    scenario: Scenario,
    *,
    log: Logger,
) -> None:
    """Limit production by workers, demand, and available factory capacity.

    Production uses units/year in year 1–3 order. One worker supports the
    configured annual units. Expansion starts at most once; only strictly earlier
    starts add capacity, so year-1 and year-2 starts first help the following year.

    Args:
        model: SCIP model to mutate; it must own ``variables``.
        variables: Three-element worker, production, and expansion arrays. Workers
            are people, production is units/year, and expansion starts are binary.
        scenario: Demand and worker/factory capacity inputs in units/year.
        log: Logger receiving entry, success, and failure events.

    Returns:
        None.

    Raises:
        ModelError: If SCIP rejects any of the 10 constraints.

    Side effects:
        Adds staffing, demand, expansion-count, and timed-capacity constraints to
        ``model`` and emits structured operation logs.
    """
    operation_log = log.bind(
        years=_YEARS,
        units_per_worker_per_year=scenario.units_per_worker_per_year,
        capacity_units_per_year=scenario.capacity_units_per_year,
        extra_capacity_units_per_year=scenario.extra_capacity_units_per_year,
    )
    operation_log.info("Adding capacity constraints...")
    try:
        model.addMatrixCons(
            variables.units_produced
            <= variables.workers * scenario.units_per_worker_per_year
        )
        model.addMatrixCons(variables.units_produced <= scenario.demand_units)
        model.addCons(quicksum(variables.expansion_start) <= 1)
        for year in range(_YEARS):
            expansion_available = quicksum(variables.expansion_start[:year])
            model.addCons(
                variables.units_produced[year]
                <= scenario.capacity_units_per_year
                + scenario.extra_capacity_units_per_year * expansion_available
            )
    except Exception as err:
        operation_log.exception("Adding capacity constraints failed.")
        raise ModelError("Could not add capacity constraints") from err
    else:
        operation_log.info("Adding capacity constraints succeeded.", constraints=10)


def add_research_constraints(
    model: Model,
    variables: ModelVariables,
    scenario: Scenario,
    *,
    log: Logger,
) -> None:
    """Apply diminishing research savings to later years' USD/unit cost.

    Year 1 starts at initial cost. In years 1 and 2, ``r`` researchers create
    ``first*r - drop*r*(r-1)/2`` of new saving. It lowers the following year's
    cost and persists thereafter. No year-4 update exists, and the variable lower
    bound enforces the cost floor without clipping.

    Args:
        model: SCIP model to mutate; it must own ``variables``.
        variables: Three-element researcher and unit-cost arrays. Researchers are
            people and unit costs are USD/unit in year 1–3 order.
        scenario: Initial/floor costs and diminishing savings in USD/unit.
        log: Logger receiving entry, success, and failure events.

    Returns:
        None.

    Raises:
        ModelError: If SCIP rejects the initial-cost or cost-update constraints.

    Side effects:
        Adds the initial cost and two next-year research updates to ``model`` and
        emits structured operation logs.
    """
    operation_log = log.bind(
        years=_YEARS,
        initial_unit_cost_usd=scenario.initial_unit_cost_usd,
        minimum_unit_cost_usd=scenario.minimum_unit_cost_usd,
        max_researchers=scenario.max_researchers,
    )
    operation_log.info("Adding research constraints...")
    try:
        model.addCons(variables.unit_cost[0] == scenario.initial_unit_cost_usd)
        for year in range(_YEARS - 1):
            researchers = variables.researchers[year]
            new_saving = (
                scenario.first_researcher_saving_usd_per_unit * researchers
                - scenario.saving_drop_per_additional_researcher
                * researchers
                * (researchers - 1)
                / 2
            )
            model.addCons(
                variables.unit_cost[year + 1] == variables.unit_cost[year] - new_saving
            )
    except Exception as err:
        operation_log.exception("Adding research constraints failed.")
        raise ModelError("Could not add research constraints") from err
    else:
        operation_log.info("Adding research constraints succeeded.", constraints=3)


def add_cash_objective(
    model: Model,
    variables: ModelVariables,
    scenario: Scenario,
    *,
    log: Logger,
) -> None:
    """Maximize cumulative three-year net cash through one scalar auxiliary.

    Annual USD cash is immediate sales revenue minus unit production cost, both
    salaries, and any expansion payment. PySCIPOpt accepts a linear objective, so
    the nonlinear cash expression bounds the scalar that SCIP maximizes.

    Args:
        model: SCIP model to mutate; it must own ``variables``.
        variables: Three-element production, cost, staffing, and expansion arrays,
            plus the scalar USD cash auxiliary.
        scenario: USD/unit price and cost, USD/year salaries, and expansion USD.
        log: Logger receiving entry, success, and failure events.

    Returns:
        None.

    Raises:
        ModelError: If SCIP rejects the cash constraint or objective.

    Side effects:
        Adds the cumulative net-cash constraint, sets the maximizing objective on
        ``model``, and emits structured operation logs.
    """
    operation_log = log.bind(
        years=_YEARS,
        selling_price_usd_per_unit=scenario.selling_price_usd_per_unit,
        worker_salary_usd_per_year=scenario.worker_salary_usd_per_year,
        researcher_salary_usd_per_year=scenario.researcher_salary_usd_per_year,
        expansion_cost_usd=scenario.expansion_cost_usd,
    )
    operation_log.info("Adding cash objective...")
    try:
        net_cash = quicksum(
            (scenario.selling_price_usd_per_unit - variables.unit_cost[year])
            * variables.units_produced[year]
            - scenario.worker_salary_usd_per_year * variables.workers[year]
            - scenario.researcher_salary_usd_per_year * variables.researchers[year]
            - scenario.expansion_cost_usd * variables.expansion_start[year]
            for year in range(_YEARS)
        )
        model.addCons(variables.cash_auxiliary <= net_cash)
        model.setObjective(variables.cash_auxiliary, "maximize")
    except Exception as err:
        operation_log.exception("Adding cash objective failed.")
        raise ModelError("Could not add cash objective") from err
    else:
        operation_log.info("Adding cash objective succeeded.", constraints=1)


def _finite_bound(name: str, value: float) -> float:
    """Keep a derived SCIP bound only when arithmetic produced a finite value."""
    if not isfinite(value):
        raise ScenarioError(f"Derived bound {name} is not finite")
    return value


def _production_upper(scenario: Scenario) -> FloatArray:
    """Bound output by demand, maximum staffing, and expanded factory capacity."""
    staffing = _finite_bound(
        "max_workers * units_per_worker_per_year",
        float(scenario.max_workers) * scenario.units_per_worker_per_year,
    )
    expanded_capacity = _finite_bound(
        "capacity_units_per_year + extra_capacity_units_per_year",
        scenario.capacity_units_per_year + scenario.extra_capacity_units_per_year,
    )
    upper = np.minimum(scenario.demand_units, np.minimum(staffing, expanded_capacity))
    if not np.all(np.isfinite(upper)):
        raise ScenarioError("Derived bound production_upper is not finite")
    return upper.astype(np.float64, copy=True)


def _matrix_variable(
    model: Model,
    name: str,
    upper: FloatArray | float,
    *,
    lower: FloatArray | float = 0.0,
    kind: Literal["C", "I", "B"] = "C",
) -> MatrixVariable:
    """Create one three-year SCIP array and narrow its incomplete return type."""
    value = model.addMatrixVar(
        shape=(_YEARS,), name=name, vtype=kind, lb=lower, ub=upper
    )
    if not isinstance(value, MatrixVariable):
        raise ModelError(f"SCIP did not create MatrixVariable {name}")
    return value


def _create_variables(model: Model, scenario: Scenario) -> ModelVariables:
    """Create finite annual variable domains in people, units, USD/unit, and USD.

    Production uses the smallest demand/staff/capacity limit. Unit cost stays
    between its floor and initial value, and final-year expansion is disabled.
    The cash lower bound covers all possible production cost, salaries, and one
    expansion; its upper bound is all possible sales revenue.
    """
    production_upper = _production_upper(scenario)
    production_total = _finite_bound(
        "sum(production_upper)", fsum(float(value) for value in production_upper)
    )
    cash_lower = -_finite_bound(
        "cash_auxiliary lower magnitude",
        scenario.initial_unit_cost_usd * production_total
        + _YEARS * scenario.worker_salary_usd_per_year * scenario.max_workers
        + _YEARS * scenario.researcher_salary_usd_per_year * scenario.max_researchers
        + scenario.expansion_cost_usd,
    )
    cash_upper = _finite_bound(
        "cash_auxiliary upper",
        scenario.selling_price_usd_per_unit * production_total,
    )
    workers = _matrix_variable(model, "workers", float(scenario.max_workers), kind="I")
    researchers = _matrix_variable(
        model, "researchers", float(scenario.max_researchers), kind="I"
    )
    expansion_start = _matrix_variable(
        model,
        "expansion_start",
        np.array([1.0, 1.0, 0.0], dtype=np.float64),
        kind="B",
    )
    units_produced = _matrix_variable(model, "units_produced", production_upper)
    unit_cost = _matrix_variable(
        model,
        "unit_cost",
        float(scenario.initial_unit_cost_usd),
        lower=float(scenario.minimum_unit_cost_usd),
    )
    cash_auxiliary = model.addVar(name="cash_auxiliary", lb=cash_lower, ub=cash_upper)
    if not isinstance(cash_auxiliary, Variable):
        raise ModelError("SCIP did not create Variable cash_auxiliary")
    return ModelVariables(
        workers=workers,
        researchers=researchers,
        expansion_start=expansion_start,
        units_produced=units_produced,
        unit_cost=unit_cost,
        cash_auxiliary=cash_auxiliary,
    )
