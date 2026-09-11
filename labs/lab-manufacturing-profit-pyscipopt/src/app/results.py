"""Serialize verified annual results and render the reader-facing table."""

from __future__ import annotations

import csv
import io
import json
import tempfile
from dataclasses import asdict, fields
from pathlib import Path

from app import output
from app.errors import ArtifactError
from app.logging_setup import Logger
from app.model import DecisionValues, SolveResult
from app.scenario import Scenario
from app.verification import AnnualRow, Verification

_CSV_NAME = "annual_plan.csv"
_JSON_NAME = "solution.json"


def _serialize_csv(verification: Verification) -> str:
    """Return the three verified rows as CSV in ``AnnualRow`` field order."""
    buffer = io.StringIO(newline="")
    field_names = [field.name for field in fields(AnnualRow)]
    writer = csv.DictWriter(buffer, fieldnames=field_names)
    writer.writeheader()
    writer.writerows(asdict(row) for row in verification.rows)
    return buffer.getvalue()


def _decision_payload(decisions: DecisionValues) -> dict[str, list[float]]:
    """Convert immutable NumPy decision arrays to raw JSON number lists."""
    return {
        "workers": decisions.workers.tolist(),
        "researchers": decisions.researchers.tolist(),
        "expansion_start": decisions.expansion_start.tolist(),
        "units_produced": decisions.units_produced.tolist(),
        "unit_cost": decisions.unit_cost.tolist(),
    }


def _serialize_json(
    scenario: Scenario, result: SolveResult, verification: Verification
) -> str:
    """Return source, settings, decisions, solver data, and verification as JSON."""
    if result.decisions is None:
        raise ArtifactError("Cannot serialize results without an incumbent")
    objective_difference = (
        None
        if result.objective_usd is None
        else verification.total_net_cash_usd - result.objective_usd
    )
    payload = {
        "input_sha256": scenario.input_sha256,
        "solver_settings": asdict(scenario.solver),
        "decisions": _decision_payload(result.decisions),
        "solver": {
            "status": result.status,
            "objective_usd": result.objective_usd,
            "objective_bound_usd": result.objective_bound_usd,
            "relative_gap": result.relative_gap,
            "solve_seconds": result.solve_seconds,
        },
        "verification": {
            "absolute_tolerance": verification.absolute_tolerance,
            "relative_tolerance": verification.relative_tolerance,
            "maximum_violation": verification.maximum_violation,
            "total_net_cash_usd": verification.total_net_cash_usd,
            "objective_difference_usd": objective_difference,
        },
    }
    return json.dumps(payload, indent=2, allow_nan=False) + "\n"


def _write_console(result: SolveResult, verification: Verification) -> None:
    """Render every annual field with concise headings and a clear units legend."""
    output.write_line()
    output.write_line("Verified annual manufacturing plan")
    output.write_line(
        "Units: people (Wkr/Rsr); flags (Start/Avail); product units (Units); "
        "USD/unit (Cost/Save); USD/year (Rev/Prod/Wkr$/Rsr$/Expand/Net)."
    )
    headers = (
        "Yr",
        "Wkr",
        "Rsr",
        "Start",
        "Avail",
        "Units",
        "Cost",
        "New save",
        "Rev",
        "Prod",
        "Wkr$",
        "Rsr$",
        "Expand",
        "Net",
    )
    output.write_line(
        f"{headers[0]:>2} {headers[1]:>3} {headers[2]:>3} {headers[3]:>5} "
        f"{headers[4]:>5} {headers[5]:>8} {headers[6]:>7} {headers[7]:>8} "
        f"{headers[8]:>11} {headers[9]:>11} {headers[10]:>10} "
        f"{headers[11]:>10} {headers[12]:>11} {headers[13]:>11}"
    )
    for row in verification.rows:
        output.write_line(
            f"{row.year:>2d} {row.workers:>3.0f} {row.researchers:>3.0f} "
            f"{row.expansion_start:>5.0f} {row.expansion_available:>5.0f} "
            f"{row.units_produced:>8,.0f} {row.unit_cost_usd:>7.2f} "
            f"{row.new_research_saving_usd_per_unit:>8.2f} "
            f"{row.revenue_usd:>11,.2f} {row.production_cost_usd:>11,.2f} "
            f"{row.worker_salaries_usd:>10,.2f} "
            f"{row.researcher_salaries_usd:>10,.2f} "
            f"{row.expansion_spending_usd:>11,.2f} "
            f"{row.annual_net_cash_usd:>11,.2f}"
        )
    output.write_line()
    output.write_line(f"Total net cash: ${verification.total_net_cash_usd:,.2f}")
    output.write_line(f"Solver status: {result.status}")
    if result.relative_gap is None:
        output.write_line("Relative gap: unavailable")
    else:
        output.write_line(f"Relative gap: {result.relative_gap:.6%}")
    if result.objective_usd is not None:
        difference = verification.total_net_cash_usd - result.objective_usd
        output.write_line(f"Solver objective: ${result.objective_usd:,.2f}")
        if abs(difference) > verification.absolute_tolerance:
            output.write_line(f"Recomputed cash differs by: ${difference:,.2f}")


def write_results(
    output_dir: Path,
    scenario: Scenario,
    result: SolveResult,
    verification: Verification,
    *,
    log: Logger,
) -> None:
    """Persist two result files safely, then print the verified annual table.

    Args:
        output_dir: Destination directory for ``annual_plan.csv`` and
            ``solution.json``; missing parent directories are created.
        scenario: Effective validated inputs and source hash used for the solve.
        result: Solver status, raw year 1–3 decision arrays, objective metadata
            in USD, relative gap, and elapsed seconds. It must have an incumbent.
        verification: Successful annual rows, recomputed three-year cash in USD,
            and numerical tolerances produced from the same decisions.
        log: Logger receiving operation entry, success, and failure events.

    Returns:
        None.

    Raises:
        ArtifactError: If serialization, directory creation, temporary-file
            writing, or final replacement fails. Both documents are serialized
            before existing targets are touched and owned temporary files are
            cleaned on failure.

    Side effects:
        Writes exactly two UTF-8 sibling files and emits the console table only
        after both replacements succeed. The two sequential replacements cannot
        provide a cross-file atomic transaction if the second replacement fails.
    """
    operation_log = log.bind(output_dir=str(output_dir))
    operation_log.info("Writing results...")
    temporary_paths: list[Path] = []
    try:
        csv_text = _serialize_csv(verification)
        json_text = _serialize_json(scenario, result, verification)
        output_dir.mkdir(parents=True, exist_ok=True)
        for name, text in ((_CSV_NAME, csv_text), (_JSON_NAME, json_text)):
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="",
                prefix=f".{name}.",
                suffix=".tmp",
                dir=output_dir,
                delete=False,
            ) as temporary_file:
                temporary_file.write(text)
                temporary_paths.append(Path(temporary_file.name))
        temporary_paths[0].replace(output_dir / _CSV_NAME)
        temporary_paths.pop(0)
        temporary_paths[0].replace(output_dir / _JSON_NAME)
        temporary_paths.pop(0)
        _write_console(result, verification)
    except Exception as err:
        operation_log.exception("Writing results failed.", output_dir=str(output_dir))
        for temporary_path in temporary_paths:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                operation_log.exception(
                    "Cleaning result temporary file failed.",
                    path=str(temporary_path),
                )
        if isinstance(err, ArtifactError):
            raise
        raise ArtifactError(f"Could not write results to {output_dir}") from err
    else:
        operation_log.info("Writing results succeeded.", files=2)
