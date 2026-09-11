"""One scenario, one solve, independent verification, then persisted reports."""

from __future__ import annotations

from dataclasses import replace
from hashlib import sha256
from pathlib import Path

from app.commands.source import read_input
from app.errors import NoIncumbentError, VerificationError
from app.logging_setup import Logger
from app.model.solve import build_model, solve_model
from app.reporting.artifacts import write_artifacts
from app.reporting.console import show_decisions, show_status
from app.reporting.serialization import RunSource
from app.scenario import derive_bounds, load_scenario, validate_scenario
from app.verification import verify_solution


def run(
    scenario_path: Path,
    output_dir: Path,
    *,
    time_limit_seconds: float | None,
    relative_gap: float | None,
    log: Logger,
) -> None:
    data = read_input(scenario_path, log=log)
    scenario = load_scenario(scenario_path, input_bytes=data, log=log)
    settings = replace(
        scenario.solver,
        time_limit_seconds=scenario.solver.time_limit_seconds
        if time_limit_seconds is None
        else time_limit_seconds,
        relative_gap=scenario.solver.relative_gap
        if relative_gap is None
        else relative_gap,
    )
    scenario = replace(scenario, solver=settings)
    validate_scenario(scenario)
    bounds = derive_bounds(scenario)
    built = build_model(scenario, bounds, log=log)
    result = solve_model(built, scenario, log=log)
    show_status(result)
    if not result.metadata.has_incumbent or result.decisions is None:
        raise NoIncumbentError(
            f"Solver status {result.metadata.status}: no feasible incumbent"
        )
    verification = verify_solution(scenario, result.decisions, log=log)
    if not verification.ok:
        details = "; ".join(
            f"{v.field}: residual={v.residual:g}, tolerance={v.tolerance:g}"
            for v in verification.violations
        )
        raise VerificationError(f"Independent verification failed: {details}")
    source = RunSource(
        str(scenario_path), sha256(data).hexdigest(), time_limit_seconds, relative_gap
    )
    write_artifacts(output_dir, scenario, result, verification, log=log, source=source)
    show_decisions(scenario, result, verification)
