"""Independent numerical verification; no solver or model-bound imports."""

from __future__ import annotations

from dataclasses import fields
from math import isfinite

import numpy as np

from app.contracts import DecisionValues, Scenario
from app.logging_setup import Logger
from app.verification.cash import compute_costs
from app.verification.common import CashBreakdown, Checks, VerificationReport, Violation
from app.verification.knowledge import check_knowledge
from app.verification.markets import check_markets
from app.verification.operations import check_operations

__all__ = ["CashBreakdown", "VerificationReport", "Violation", "verify_solution"]


def _validate_arrays(d: DecisionValues, c: Checks) -> None:
    shapes = (
        (4, 4, 3),
        (4, 3),
        (4, 3, 3),
        (3,),
        (3,),
        (3,),
        (4, 2, 3),
        (4, 2, 3),
        (4, 2, 3),
        (2, 2, 3),
        (2, 4, 2, 3),
        (2, 3),
        (2, 3),
    )
    for field, shape in zip(fields(d)[:-1], shapes, strict=True):
        value = getattr(d, field.name)
        if not isinstance(value, np.ndarray) or value.shape != shape:
            c.violations.append(
                Violation("decision_shape", field.name, float("inf"), 0.0)
            )
        elif value.dtype.kind not in "fiu" or not np.isfinite(value).all():
            c.violations.append(
                Violation("decision_finite", field.name, float("inf"), 0.0)
            )
    if not isfinite(d.cash_auxiliary):
        c.violations.append(
            Violation("decision_finite", "cash_auxiliary", float("inf"), 0.0)
        )


def _verify_numeric(
    scenario: Scenario, decisions: DecisionValues
) -> VerificationReport:
    """Return all violations; malformed input has unavailable (NaN) cash totals."""
    c = Checks(scenario.solver)
    _validate_arrays(decisions, c)
    if c.violations:
        unavailable = CashBreakdown(*(np.full(3, np.nan) for _ in range(9)))
        return VerificationReport(
            False, tuple(c.violations), unavailable, np.full((4, 3), np.nan)
        )
    for field in fields(decisions)[:-1]:
        c.compare(f"{field.name}_nonnegative", 0.0, getattr(decisions, field.name))
    for name in ("headcount", "investment_start", "product_active"):
        c.integer(name, getattr(decisions, name))
    try:
        with np.errstate(over="raise", invalid="raise", divide="raise"):
            costs = compute_costs(scenario, decisions)
            check_knowledge(scenario, decisions, c)
            check_markets(scenario, decisions, c)
            check_operations(scenario, decisions, costs, c)
    except FloatingPointError:
        c.violations.append(
            Violation("decision_arithmetic", "decisions", float("inf"), 0.0)
        )
        unavailable = CashBreakdown(*(np.full(3, np.nan) for _ in range(9)))
        return VerificationReport(
            False, tuple(c.violations), unavailable, np.full((4, 3), np.nan)
        )
    return VerificationReport(
        not c.violations, tuple(c.violations), costs.cash, costs.regional
    )


def verify_solution(
    scenario: Scenario, decisions: DecisionValues, *, log: Logger | None = None
) -> VerificationReport:
    """Independently check numerical decisions, logging at this operation boundary."""
    if log is not None:
        log.info("Verifying solution...")
    try:
        report = _verify_numeric(scenario, decisions)
    except Exception:
        if log is not None:
            log.exception("Verifying solution failed.")
        raise
    else:
        if log is not None:
            log.info(
                "Verifying solution succeeded.",
                ok=report.ok,
                violations=len(report.violations),
            )
        return report
