"""Build the bounded MINLP and extract only an actual feasible incumbent."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite

from pyscipopt import Model

from app.contracts import DerivedBounds, Scenario, SolveMetadata, SolveResult
from app.logging_setup import Logger
from app.model.constraints import (
    add_budget_constraints,
    add_cash_objective,
    add_electricity_constraints,
    add_factory_constraints,
    add_flow_constraints,
    add_investment_constraints,
    add_knowledge_constraints,
    add_market_constraints,
    add_rd_constraints,
    add_staffing_constraints,
)
from app.model.extraction import extract_decisions
from app.model.variables import ModelVariables, create_variables


@dataclass(frozen=True)
class BuiltModel:
    """The solver instance and its named decision arrays."""

    model: Model
    variables: ModelVariables


def build_model(
    scenario: Scenario, bounds: DerivedBounds, *, log: Logger
) -> BuiltModel:
    """Build one three-year cash model without optimizing it."""
    log.info("Building model...", years=scenario.axes.years)
    try:
        model = Model("manufacturing_profit")
        model.hideOutput()
        v = create_variables(model, scenario, bounds)
        add_investment_constraints(model, v, scenario)
        add_staffing_constraints(model, v, scenario)
        add_rd_constraints(model, v, scenario)
        add_knowledge_constraints(model, v, scenario, bounds)
        add_factory_constraints(model, v, scenario)
        add_market_constraints(model, v, scenario)
        add_flow_constraints(model, v)
        add_electricity_constraints(model, v, scenario)
        add_budget_constraints(model, v, scenario)
        add_cash_objective(model, v, scenario)
    except Exception:
        log.exception("Building model failed.", years=scenario.axes.years)
        raise
    else:
        log.info(
            "Building model succeeded.",
            variables=model.getNVars(),
            constraints=model.getNConss(),
        )
        return BuiltModel(model, v)


def _finite_statistic(model: Model, value: float) -> float | None:
    return value if isfinite(value) and not model.isInfinity(abs(value)) else None


def solve_model(built: BuiltModel, scenario: Scenario, *, log: Logger) -> SolveResult:
    """Apply limits and return actual termination data, with optional decisions."""
    settings = scenario.solver
    log.info(
        "Solving model...",
        time_limit_seconds=settings.time_limit_seconds,
        relative_gap=settings.relative_gap,
    )
    try:
        model = built.model
        variables, constraints = int(model.getNVars()), int(model.getNConss())
        model.setRealParam("limits/time", settings.time_limit_seconds)
        model.setRealParam("limits/gap", settings.relative_gap)
        model.optimize()
        has_incumbent = int(model.getNSols()) > 0
        decisions = None
        if has_incumbent:
            decisions = extract_decisions(model, model.getBestSol(), built.variables)
        metadata = SolveMetadata(
            status=str(model.getStatus()),
            has_incumbent=has_incumbent,
            solve_seconds=float(model.getSolvingTime()),
            objective_bound=_finite_statistic(model, float(model.getDualbound())),
            relative_gap=_finite_statistic(model, float(model.getGap()))
            if has_incumbent
            else None,
            node_count=int(model.getNNodes()),
            variable_count=variables,
            constraint_count=constraints,
            scip_version=f"{model.getMajorVersion()}.{model.getMinorVersion()}.{model.getTechVersion()}",
        )
    except Exception:
        log.exception(
            "Solving model failed.",
            time_limit_seconds=settings.time_limit_seconds,
            relative_gap=settings.relative_gap,
        )
        raise
    else:
        log.info(
            "Solving model succeeded.",
            status=metadata.status,
            has_incumbent=has_incumbent,
            solve_seconds=metadata.solve_seconds,
        )
        return SolveResult(metadata, decisions)
