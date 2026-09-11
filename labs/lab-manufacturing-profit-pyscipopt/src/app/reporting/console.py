"""Human-facing solver status and compact, labelled decision tables."""

from __future__ import annotations

from app.contracts import Scenario, SolveResult
from app.output import write_line
from app.reporting.breakdowns import build_tables
from app.reporting.serialization import classification
from app.reporting.tables import Cell
from app.verification import VerificationReport


def show_status(result: SolveResult) -> None:
    m = result.metadata
    write_line(f"Solver status: {m.status}; classification: {classification(result)}")
    write_line(
        f"Time: {m.solve_seconds:.3f}s; bound (MUSD): {m.objective_bound}; "
        f"relative gap: {m.relative_gap}"
    )
    write_line(
        f"SCIP {m.scip_version}; variables: {m.variable_count}; "
        f"constraints: {m.constraint_count}; nodes: {m.node_count}"
    )


def _format(value: Cell) -> str:
    return f"{value:.6g}" if isinstance(value, float) else str(value)


def show_decisions(s: Scenario, result: SolveResult, v: VerificationReport) -> None:
    d = result.decisions
    assert d is not None
    write_line(f"Solver auxiliary objective (MUSD): {d.cash_auxiliary:.9g}")
    write_line(
        f"Independently recomputed cumulative cash (MUSD): {v.cash.net_cash.sum():.9g}"
    )
    for table in build_tables(s, d, v):
        write_line()
        write_line(table.title)
        write_line(" | ".join(table.columns))
        for row in table.rows:
            write_line(" | ".join(_format(value) for value in row))
