"""Independently verify annual decisions and recompute their cash results."""

from __future__ import annotations

from dataclasses import dataclass
from math import fsum

import numpy as np

from app.errors import VerificationError
from app.logging_setup import Logger
from app.model import DecisionValues
from app.scenario import Scenario

_YEARS = 3
_ABSOLUTE_TOLERANCE = 1e-5
_RELATIVE_TOLERANCE = 1e-7


@dataclass(frozen=True)
class AnnualRow:
    """Verified values and cash arithmetic for one displayed calendar year.

    Staffing fields are people; expansion fields are zero-or-one decisions and
    cumulative availability; production is units/year; unit cost and new saving
    are USD/unit; revenue, costs, salaries, spending, and net cash are USD/year.
    Values remain raw floats until the console renderer formats them.
    """

    year: int
    workers: float
    researchers: float
    expansion_start: float
    expansion_available: float
    units_produced: float
    unit_cost_usd: float
    new_research_saving_usd_per_unit: float
    revenue_usd: float
    production_cost_usd: float
    worker_salaries_usd: float
    researcher_salaries_usd: float
    expansion_spending_usd: float
    annual_net_cash_usd: float


@dataclass(frozen=True)
class Verification:
    """Successful verification rows, cash total, and dimensionless error ratio.

    ``maximum_violation`` is the largest positive residual divided by its
    applicable tolerance. It is at most one for every returned instance.
    """

    rows: tuple[AnnualRow, ...]
    total_net_cash_usd: float
    maximum_violation: float
    absolute_tolerance: float
    relative_tolerance: float


def _validate_decision_arrays(decisions: DecisionValues) -> None:
    """Require five finite decision arrays with the fixed three-year shape."""
    arrays = (
        ("workers", decisions.workers),
        ("researchers", decisions.researchers),
        ("expansion_start", decisions.expansion_start),
        ("units_produced", decisions.units_produced),
        ("unit_cost", decisions.unit_cost),
    )
    for name, values in arrays:
        if values.shape != (_YEARS,):
            raise VerificationError(f"{name} must have shape (3,)")
        if not np.all(np.isfinite(values)):
            raise VerificationError(f"{name} must contain only finite values")


def _scaled_tolerance(lhs: float, rhs: float) -> float:
    """Return absolute-plus-relative tolerance for two physical values."""
    return _ABSOLUTE_TOLERANCE + _RELATIVE_TOLERANCE * max(abs(lhs), abs(rhs))


def _year_location(year: int | None) -> str:
    """Describe the displayed year for a failed residual when one applies."""
    return "" if year is None else f" in year {year + 1}"


def verify_solution(
    scenario: Scenario, decisions: DecisionValues, *, log: Logger
) -> Verification:
    """Check an incumbent independently and calculate its three annual rows.

    Args:
        scenario: Validated business limits in USD, product units, and people.
        decisions: Five raw float arrays with shape ``(3,)`` ordered year 1,
            year 2, year 3. Research savings and expansion capacity begin in
            the year after their corresponding decision.
        log: Logger receiving operation entry, success, and failure events.

    Returns:
        Verified annual arithmetic with raw floats, total three-year net cash
        in USD, and the largest dimensionless residual-to-tolerance ratio.

    Raises:
        VerificationError: If an array has the wrong shape or a non-finite
            value, or any domain, integrality, timing, recurrence, capacity,
            demand, or cost-floor rule exceeds its numerical tolerance.

    Side effects:
        Emits structured logs. It does not mutate inputs, call SCIP, or write
        artifacts. Array indices are zero-based; row years are displayed 1–3.
    """
    operation_log = log.bind(years=_YEARS)
    operation_log.info("Verifying solution...")
    maximum_violation = 0.0

    def check(rule: str, year: int | None, residual: float, tolerance: float) -> None:
        """Track one scaled residual and reject it when tolerance is exceeded."""
        nonlocal maximum_violation
        positive_residual = max(0.0, float(residual))
        maximum_violation = max(maximum_violation, positive_residual / tolerance)
        if positive_residual > tolerance:
            raise VerificationError(
                f"{rule}{_year_location(year)} failed: residual={positive_residual:g}, "
                f"tolerance={tolerance:g}"
            )

    try:
        _validate_decision_arrays(decisions)
        for year in range(_YEARS):
            worker = float(decisions.workers[year])
            researcher = float(decisions.researchers[year])
            expansion = float(decisions.expansion_start[year])
            produced = float(decisions.units_produced[year])
            unit_cost = float(decisions.unit_cost[year])

            discrete_values = (
                ("worker integrality", worker),
                ("researcher integrality", researcher),
                ("expansion binary", expansion),
            )
            for rule, value in discrete_values:
                check(rule, year, abs(value - round(value)), _ABSOLUTE_TOLERANCE)
            lower_bounds = (
                ("workers lower bound", worker),
                ("researchers lower bound", researcher),
                ("expansion_start lower bound", expansion),
                ("units_produced lower bound", produced),
            )
            for rule, value in lower_bounds:
                check(rule, year, -value, _scaled_tolerance(0.0, value))
            check(
                "worker maximum",
                year,
                worker - scenario.max_workers,
                _scaled_tolerance(worker, float(scenario.max_workers)),
            )
            check(
                "researcher maximum",
                year,
                researcher - scenario.max_researchers,
                _scaled_tolerance(researcher, float(scenario.max_researchers)),
            )
            check(
                "expansion binary",
                year,
                expansion - 1.0,
                _scaled_tolerance(expansion, 1.0),
            )
            check(
                "cost floor",
                year,
                scenario.minimum_unit_cost_usd - unit_cost,
                _scaled_tolerance(scenario.minimum_unit_cost_usd, unit_cost),
            )
            check(
                "initial cost upper bound",
                year,
                unit_cost - scenario.initial_unit_cost_usd,
                _scaled_tolerance(unit_cost, scenario.initial_unit_cost_usd),
            )

        check(
            "final-year expansion",
            _YEARS - 1,
            abs(float(decisions.expansion_start[-1])),
            _ABSOLUTE_TOLERANCE,
        )
        expansion_count = float(np.sum(decisions.expansion_start))
        check(
            "expansion count",
            None,
            expansion_count - 1.0,
            _scaled_tolerance(expansion_count, 1.0),
        )

        new_saving = (
            scenario.first_researcher_saving_usd_per_unit * decisions.researchers
            - scenario.saving_drop_per_additional_researcher
            * decisions.researchers
            * (decisions.researchers - 1)
            / 2
        )
        expected_cost = (
            scenario.initial_unit_cost_usd - np.r_[0.0, np.cumsum(new_saving[:-1])]
        )
        availability = np.r_[0.0, np.cumsum(decisions.expansion_start[:-1])]

        for year in range(_YEARS):
            cost = float(decisions.unit_cost[year])
            expected = float(expected_cost[year])
            check(
                "research recurrence",
                year,
                abs(cost - expected),
                _scaled_tolerance(cost, expected),
            )
            produced = float(decisions.units_produced[year])
            demand = float(scenario.demand_units[year])
            staffed_output = (
                float(decisions.workers[year]) * scenario.units_per_worker_per_year
            )
            available_capacity = (
                scenario.capacity_units_per_year
                + scenario.extra_capacity_units_per_year * float(availability[year])
            )
            check(
                "demand",
                year,
                produced - demand,
                _scaled_tolerance(produced, demand),
            )
            check(
                "worker output",
                year,
                produced - staffed_output,
                _scaled_tolerance(produced, staffed_output),
            )
            check(
                "physical capacity",
                year,
                produced - available_capacity,
                _scaled_tolerance(produced, available_capacity),
            )

        revenue = scenario.selling_price_usd_per_unit * decisions.units_produced
        production_cost = decisions.unit_cost * decisions.units_produced
        worker_salaries = scenario.worker_salary_usd_per_year * decisions.workers
        researcher_salaries = (
            scenario.researcher_salary_usd_per_year * decisions.researchers
        )
        expansion_spending = scenario.expansion_cost_usd * decisions.expansion_start
        annual_cash = (
            revenue
            - production_cost
            - worker_salaries
            - researcher_salaries
            - expansion_spending
        )
        rows = tuple(
            AnnualRow(
                year=year + 1,
                workers=float(decisions.workers[year]),
                researchers=float(decisions.researchers[year]),
                expansion_start=float(decisions.expansion_start[year]),
                expansion_available=float(availability[year]),
                units_produced=float(decisions.units_produced[year]),
                unit_cost_usd=float(decisions.unit_cost[year]),
                new_research_saving_usd_per_unit=float(new_saving[year]),
                revenue_usd=float(revenue[year]),
                production_cost_usd=float(production_cost[year]),
                worker_salaries_usd=float(worker_salaries[year]),
                researcher_salaries_usd=float(researcher_salaries[year]),
                expansion_spending_usd=float(expansion_spending[year]),
                annual_net_cash_usd=float(annual_cash[year]),
            )
            for year in range(_YEARS)
        )
        verification = Verification(
            rows=rows,
            total_net_cash_usd=fsum(row.annual_net_cash_usd for row in rows),
            maximum_violation=maximum_violation,
            absolute_tolerance=_ABSOLUTE_TOLERANCE,
            relative_tolerance=_RELATIVE_TOLERANCE,
        )
    except VerificationError:
        operation_log.exception("Verifying solution failed.", years=_YEARS)
        raise
    except Exception as err:
        operation_log.exception("Verifying solution failed.", years=_YEARS)
        raise VerificationError("Could not verify solver decisions") from err
    else:
        operation_log.info(
            "Verifying solution succeeded.",
            years=len(verification.rows),
            maximum_violation=verification.maximum_violation,
        )
        return verification
