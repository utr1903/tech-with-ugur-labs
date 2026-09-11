"""Orchestrate one scenario from validated input through verified artifacts."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from app.errors import NoIncumbentError
from app.logging_setup import Logger
from app.model import DecisionValues, build_model
from app.results import write_results
from app.scenario import load_scenario, validate_scenario
from app.solver import solve_model
from app.verification import verify_solution


def _require_incumbent(
    result_decisions: DecisionValues | None, status: str
) -> DecisionValues:
    """Return decisions or reject a solver outcome without an incumbent."""
    if result_decisions is None:
        raise NoIncumbentError(f"Solver status {status}: no feasible incumbent")
    return result_decisions


def run(
    scenario_path: Path,
    output_dir: Path,
    *,
    time_limit_seconds: float | None,
    relative_gap: float | None,
    log: Logger,
) -> None:
    """Solve one scenario, verify its incumbent, and publish both result files.

    Args:
        scenario_path: UTF-8 YAML source containing the fixed three-year inputs.
        output_dir: Destination for ``annual_plan.csv`` and ``solution.json``.
        time_limit_seconds: Optional positive finite CLI override in seconds;
            ``None`` retains the YAML value.
        relative_gap: Optional finite CLI override in ``[0, 1)``; ``None``
            retains the YAML value.
        log: Logger passed to every operation boundary.

    Returns:
        None.

    Raises:
        ScenarioError: If YAML or effective overrides violate the input contract.
        ModelError: If model construction or optimization fails.
        NoIncumbentError: If SCIP finishes without a feasible decision vector.
        VerificationError: If the independent three-year numerical checks fail.
        ArtifactError: If either result file cannot be safely persisted.

    Side effects:
        Reads the scenario, runs SCIP, emits structured logs, and writes files
        plus the reader-facing console table only after verification succeeds.
        Existing artifacts remain untouched on all earlier failure paths.
    """
    operation_log = log.bind(
        scenario_path=str(scenario_path), output_dir=str(output_dir)
    )
    operation_log.info("Running manufacturing plan...")
    try:
        scenario = load_scenario(scenario_path, log=log)
        settings = replace(
            scenario.solver,
            time_limit_seconds=(
                scenario.solver.time_limit_seconds
                if time_limit_seconds is None
                else time_limit_seconds
            ),
            relative_gap=(
                scenario.solver.relative_gap if relative_gap is None else relative_gap
            ),
        )
        scenario = replace(scenario, solver=settings)
        validate_scenario(scenario)
        built = build_model(scenario, log=log)
        result = solve_model(built, scenario.solver, log=log)
        decisions = _require_incumbent(result.decisions, result.status)
        verification = verify_solution(scenario, decisions, log=log)
        write_results(output_dir, scenario, result, verification, log=log)
    except Exception:
        operation_log.exception("Running manufacturing plan failed.")
        raise
    else:
        operation_log.info(
            "Running manufacturing plan succeeded.",
            status=result.status,
            total_net_cash_usd=verification.total_net_cash_usd,
        )
