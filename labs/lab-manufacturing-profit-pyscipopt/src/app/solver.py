"""Optimize a built manufacturing model and safely extract solver results."""

from __future__ import annotations

from math import isfinite
from numbers import Real

import numpy as np
from pyscipopt import MatrixVariable, Model, Variable
from pyscipopt.scip import Solution

from app.errors import ModelError
from app.logging_setup import Logger
from app.model import BuiltModel, DecisionValues, ModelVariables, SolveResult
from app.scenario import FloatArray, SolverSettings, validate_solver_settings

_YEARS = 3


def _read_array(
    model: Model, solution: Solution, variable: MatrixVariable, name: str
) -> FloatArray:
    """Extract one finite year 1–3 array without rounding solver values."""
    raw = model.getSolVal(solution, variable)
    if not isinstance(raw, np.ndarray):
        raise ModelError(f"SCIP returned a non-array value for {name}")
    values = np.array(raw, dtype=np.float64, copy=True)
    if values.shape != (_YEARS,) or not np.all(np.isfinite(values)):
        raise ModelError(f"SCIP returned invalid three-year values for {name}")
    return values


def _read_objective(model: Model, solution: Solution, variable: Variable) -> float:
    """Extract the finite cash auxiliary in USD from one incumbent."""
    raw = model.getSolVal(solution, variable)
    if isinstance(raw, bool) or not isinstance(raw, Real):
        raise ModelError("SCIP returned a non-scalar cash objective")
    objective = float(raw)
    if not isfinite(objective):
        raise ModelError("SCIP returned a non-finite cash objective")
    return objective


def _best_solution(model: Model) -> Solution:
    """Return SCIP's incumbent after its reported solution count was positive."""
    solution = model.getBestSol()
    if not isinstance(solution, Solution):
        raise ModelError("SCIP reported a solution but returned no incumbent")
    return solution


def _metadata_value(model: Model, value: object) -> float | None:
    """Map SCIP infinity and nonnumeric or non-finite statistics to ``None``."""
    if isinstance(value, bool) or not isinstance(value, Real):
        return None
    number = float(value)
    if not isfinite(number) or bool(model.isInfinity(abs(number))):
        return None
    return number


def _extract_decisions(
    model: Model, solution: Solution, variables: ModelVariables
) -> DecisionValues:
    """Read five annual arrays; DecisionValues copies and freezes each one."""
    return DecisionValues(
        workers=_read_array(model, solution, variables.workers, "workers"),
        researchers=_read_array(model, solution, variables.researchers, "researchers"),
        expansion_start=_read_array(
            model, solution, variables.expansion_start, "expansion_start"
        ),
        units_produced=_read_array(
            model, solution, variables.units_produced, "units_produced"
        ),
        unit_cost=_read_array(model, solution, variables.unit_cost, "unit_cost"),
    )


def solve_model(
    built: BuiltModel, settings: SolverSettings, *, log: Logger
) -> SolveResult:
    """Optimize a built model and return safe incumbent data and metadata.

    ``settings`` contains seconds and a relative gap. The function sets both SCIP
    limits, optimizes, and checks the solution count before accessing a solution.
    Arrays remain raw year 1–3 floats. With no incumbent, decisions, auxiliary
    objective USD, and gap are ``None``. Unavailable or infinite bound/gap values
    are also ``None``; status and elapsed solve seconds are always retained.

    Args:
        built: In-memory SCIP model and its five year 1–3 decision arrays plus
            scalar USD cash auxiliary.
        settings: Positive time limit in seconds and relative gap in ``[0, 1)``.
        log: Logger receiving solve entry, success, and failure events.

    Returns:
        Solver status, elapsed seconds, finite objective metadata, and either raw
        incumbent floats or ``None`` when SCIP found no incumbent.

    Raises:
        ScenarioError: If solve-time overrides violate the scenario contract.
        ModelError: If SCIP fails or returns invalid incumbent values.

    Side effects:
        Sets limits on ``built.model``, runs SCIP, updates that model's solve
        state, and emits structured logs. It does not verify or write the result.
    """
    validate_solver_settings(settings)
    operation_log = log.bind(
        time_limit_seconds=settings.time_limit_seconds,
        relative_gap=settings.relative_gap,
    )
    operation_log.info("Solving model...")
    try:
        model = built.model
        model.setRealParam("limits/time", settings.time_limit_seconds)
        model.setRealParam("limits/gap", settings.relative_gap)
        model.optimize()
        has_incumbent = int(model.getNSols()) > 0
        decisions: DecisionValues | None = None
        objective: float | None = None
        gap: float | None = None
        if has_incumbent:
            solution = _best_solution(model)
            decisions = _extract_decisions(model, solution, built.variables)
            objective = _read_objective(model, solution, built.variables.cash_auxiliary)
            gap = _metadata_value(model, model.getGap())
        result = SolveResult(
            decisions=decisions,
            status=str(model.getStatus()),
            objective_usd=objective,
            objective_bound_usd=_metadata_value(model, model.getDualbound()),
            relative_gap=gap,
            solve_seconds=float(model.getSolvingTime()),
        )
    except ModelError:
        operation_log.exception("Solving model failed.")
        raise
    except Exception as err:
        operation_log.exception("Solving model failed.")
        raise ModelError("Could not solve manufacturing model") from err
    else:
        operation_log.info(
            "Solving model succeeded.",
            status=result.status,
            has_incumbent=result.decisions is not None,
            solve_seconds=result.solve_seconds,
        )
        return result
