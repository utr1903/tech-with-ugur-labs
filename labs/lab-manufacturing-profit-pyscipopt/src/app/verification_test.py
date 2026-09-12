"""Independent numerical verification tests for extracted solver decisions."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from app.errors import VerificationError
from app.logging_setup import Logger
from app.model import DecisionValues
from app.scenario import Scenario
from app.verification import verify_solution


@pytest.fixture
def worked_decisions() -> DecisionValues:
    """Return the hand-calculated research and cash example from the design."""
    return DecisionValues(
        workers=np.array([4.0, 4.0, 4.0]),
        researchers=np.array([2.0, 1.0, 0.0]),
        expansion_start=np.array([0.0, 0.0, 0.0]),
        units_produced=np.array([4000.0, 4000.0, 4000.0]),
        unit_cost=np.array([50.0, 43.0, 39.0]),
    )


def test_worked_research_cash(
    scenario: Scenario, worked_decisions: DecisionValues, log: Logger
) -> None:
    """Lagged persistent savings produce the three hand-derived cash amounts."""
    verified = verify_solution(scenario, worked_decisions, log=log)

    assert [row.new_research_saving_usd_per_unit for row in verified.rows] == [
        7,
        4,
        0,
    ]
    assert [row.annual_net_cash_usd for row in verified.rows] == [
        60000,
        98000,
        124000,
    ]
    assert verified.total_net_cash_usd == 282000
    assert verified.maximum_violation == 0


def test_rejects_savings_applied_in_the_current_year(
    scenario: Scenario, worked_decisions: DecisionValues, log: Logger
) -> None:
    """Year-one unit cost cannot include research hired during year one."""
    with pytest.raises(VerificationError, match="research recurrence.*year 1"):
        verify_solution(
            scenario,
            replace(worked_decisions, unit_cost=np.array([43.0, 39.0, 39.0])),
            log=log,
        )


@pytest.mark.parametrize(
    ("field", "values"),
    [
        ("workers", np.array([4.0, 4.0])),
        ("researchers", np.array([2.0, np.inf, 0.0])),
        ("expansion_start", np.array([0.0, 0.0, np.nan])),
        ("units_produced", np.array([[4000.0, 4000.0, 4000.0]])),
        ("unit_cost", np.array([50.0, 43.0, -np.inf])),
    ],
)
def test_rejects_wrong_shape_or_nonfinite_decision_arrays(
    scenario: Scenario,
    worked_decisions: DecisionValues,
    log: Logger,
    field: str,
    values: np.ndarray,
) -> None:
    """Every extracted decision must contain three finite annual values."""
    with pytest.raises(VerificationError, match=field):
        verify_solution(
            scenario,
            replace(worked_decisions, **{field: values}),
            log=log,
        )


@pytest.mark.parametrize(
    ("field", "values", "rule"),
    [
        ("workers", np.array([4.25, 4.0, 4.0]), "worker integrality"),
        ("researchers", np.array([2.0, 1.25, 0.0]), "researcher integrality"),
        ("expansion_start", np.array([0.0, 0.25, 0.0]), "expansion binary"),
    ],
)
def test_rejects_fractional_discrete_decisions(
    scenario: Scenario,
    worked_decisions: DecisionValues,
    log: Logger,
    field: str,
    values: np.ndarray,
    rule: str,
) -> None:
    """Worker and researcher counts are integral and expansion starts are binary."""
    with pytest.raises(VerificationError, match=rule):
        verify_solution(
            scenario,
            replace(worked_decisions, **{field: values}),
            log=log,
        )


@pytest.mark.parametrize(
    ("field", "values"),
    [
        ("workers", np.array([-1.0, 4.0, 4.0])),
        ("researchers", np.array([2.0, -1.0, 0.0])),
        ("expansion_start", np.array([-1.0, 0.0, 0.0])),
        ("units_produced", np.array([-1.0, 4000.0, 4000.0])),
    ],
)
def test_rejects_negative_decisions(
    scenario: Scenario,
    worked_decisions: DecisionValues,
    log: Logger,
    field: str,
    values: np.ndarray,
) -> None:
    """All staffing, investment, and production decisions have zero lower bounds."""
    with pytest.raises(VerificationError, match=f"{field} lower bound"):
        verify_solution(
            scenario,
            replace(worked_decisions, **{field: values}),
            log=log,
        )


@pytest.mark.parametrize(
    ("field", "values", "rule"),
    [
        ("workers", np.array([7.0, 4.0, 4.0]), "worker maximum"),
        ("researchers", np.array([4.0, 1.0, 0.0]), "researcher maximum"),
    ],
)
def test_rejects_staffing_above_configured_maximum(
    scenario: Scenario,
    worked_decisions: DecisionValues,
    log: Logger,
    field: str,
    values: np.ndarray,
    rule: str,
) -> None:
    """Annual headcounts cannot exceed their separate scenario limits."""
    with pytest.raises(VerificationError, match=rule):
        verify_solution(
            scenario,
            replace(worked_decisions, **{field: values}),
            log=log,
        )


def test_rejects_current_year_expansion_capacity(
    scenario: Scenario, worked_decisions: DecisionValues, log: Logger
) -> None:
    """A year-one expansion cannot increase physical capacity until year two."""
    roomy_demand = replace(scenario, demand_units=np.array([6000.0, 6000.0, 6000.0]))
    corrupted = replace(
        worked_decisions,
        workers=np.array([6.0, 4.0, 4.0]),
        expansion_start=np.array([1.0, 0.0, 0.0]),
        units_produced=np.array([6000.0, 4000.0, 4000.0]),
    )

    with pytest.raises(VerificationError, match="physical capacity.*year 1"):
        verify_solution(roomy_demand, corrupted, log=log)


@pytest.mark.parametrize(
    ("starts", "rule"),
    [
        (np.array([0.0, 0.0, 1.0]), "final-year expansion"),
        (np.array([1.0, 1.0, 0.0]), "expansion count"),
    ],
)
def test_rejects_final_year_or_multiple_expansion_starts(
    scenario: Scenario,
    worked_decisions: DecisionValues,
    log: Logger,
    starts: np.ndarray,
    rule: str,
) -> None:
    """Expansion may start once in year one or two, never in year three."""
    with pytest.raises(VerificationError, match=rule):
        verify_solution(
            scenario,
            replace(worked_decisions, expansion_start=starts),
            log=log,
        )


def test_rejects_production_above_demand(
    scenario: Scenario,
    worked_decisions: DecisionValues,
    log: Logger,
) -> None:
    """Annual production cannot exceed that year's independent demand limit."""
    corrupted = replace(
        worked_decisions, units_produced=np.array([4000.0, 6001.0, 4000.0])
    )

    with pytest.raises(VerificationError, match="demand"):
        verify_solution(scenario, corrupted, log=log)


def test_rejects_production_above_staffed_output(
    scenario: Scenario,
    worked_decisions: DecisionValues,
    log: Logger,
) -> None:
    """Annual production cannot exceed workers times per-person output."""
    roomy_factory = replace(scenario, capacity_units_per_year=6000.0)
    corrupted = replace(
        worked_decisions,
        workers=np.array([4.0, 3.0, 4.0]),
        units_produced=np.array([4000.0, 4000.0, 4000.0]),
    )

    with pytest.raises(VerificationError, match="worker output"):
        verify_solution(roomy_factory, corrupted, log=log)


def test_rejects_production_above_physical_capacity(
    scenario: Scenario,
    worked_decisions: DecisionValues,
    log: Logger,
) -> None:
    """Annual production cannot exceed factory capacity available that year."""
    roomy_demand = replace(scenario, demand_units=np.array([6000.0] * 3))
    corrupted = replace(
        worked_decisions,
        workers=np.array([5.0, 4.0, 4.0]),
        units_produced=np.array([5000.0, 4000.0, 4000.0]),
    )

    with pytest.raises(VerificationError, match="physical capacity"):
        verify_solution(roomy_demand, corrupted, log=log)


def test_rejects_cost_below_floor(
    scenario: Scenario, worked_decisions: DecisionValues, log: Logger
) -> None:
    """The configured minimum cost remains a constraint rather than a clip."""
    with pytest.raises(VerificationError, match="cost floor.*year 3"):
        verify_solution(
            replace(scenario, minimum_unit_cost_usd=40.0),
            worked_decisions,
            log=log,
        )


def test_rejects_broken_persistent_research_recurrence(
    scenario: Scenario, worked_decisions: DecisionValues, log: Logger
) -> None:
    """Year-three cost must retain year-one savings and add year-two savings."""
    with pytest.raises(VerificationError, match="research recurrence.*year 3"):
        verify_solution(
            scenario,
            replace(worked_decisions, unit_cost=np.array([50.0, 43.0, 46.0])),
            log=log,
        )


def test_allows_integrality_residual_at_absolute_tolerance(
    scenario: Scenario, worked_decisions: DecisionValues, log: Logger
) -> None:
    """A discrete value exactly 1e-5 from its integer survives solver noise."""
    verified = verify_solution(
        scenario,
        replace(worked_decisions, workers=np.array([4.00001, 4.0, 4.0])),
        log=log,
    )

    assert verified.maximum_violation == pytest.approx(1.0)


def test_rejects_integrality_residual_beyond_absolute_tolerance(
    scenario: Scenario, worked_decisions: DecisionValues, log: Logger
) -> None:
    """A discrete value clearly more than 1e-5 from an integer is invalid."""
    with pytest.raises(VerificationError, match="worker integrality"):
        verify_solution(
            scenario,
            replace(worked_decisions, workers=np.array([4.00002, 4.0, 4.0])),
            log=log,
        )


def test_allows_constraint_residual_within_scaled_tolerance(
    scenario: Scenario, worked_decisions: DecisionValues, log: Logger
) -> None:
    """A tiny demand excess within absolute-plus-relative tolerance is accepted."""
    verified = verify_solution(
        scenario,
        replace(
            worked_decisions,
            units_produced=np.array([4000.0004, 4000.0, 4000.0]),
        ),
        log=log,
    )

    assert 0 < verified.maximum_violation <= 1


def test_rejects_constraint_residual_beyond_scaled_tolerance(
    scenario: Scenario, worked_decisions: DecisionValues, log: Logger
) -> None:
    """A demand excess beyond absolute-plus-relative tolerance is invalid."""
    with pytest.raises(VerificationError, match="demand.*year 1"):
        verify_solution(
            scenario,
            replace(
                worked_decisions,
                units_produced=np.array([4000.001, 4000.0, 4000.0]),
            ),
            log=log,
        )
