"""Adversarial tests of finite auxiliary domains, including permitted slack."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from app.contracts import DecisionValues, Scenario
from app.verification import verify_solution


def test_rejects_unbounded_negative_cash(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    report = verify_solution(scenario, replace(feasible_values, cash_auxiliary=-1e9))
    assert "cash_lower_bound" in {v.code for v in report.violations}


def test_rejects_unbounded_electricity_bill(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    report = verify_solution(
        scenario, replace(feasible_values, electricity_cost=np.full((2, 3), 1e9))
    )
    assert "electricity_upper_bound" in {v.code for v in report.violations}


def test_accepts_exact_auxiliary_domain_boundaries(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    upper = np.array([[3.48, 4.98, 5.28], [0.0, 2.38, 2.61]])
    report = verify_solution(
        scenario,
        replace(feasible_values, electricity_cost=upper, cash_auxiliary=-5487.668),
    )
    assert report.ok, report.violations


@pytest.mark.parametrize("field", ["cash", "electricity", "closed_china"])
def test_rejects_just_outside_finite_bounds(
    scenario: Scenario, feasible_values: DecisionValues, field: str
) -> None:
    upper = np.array([[3.48, 4.98, 5.28], [0.0, 2.38, 2.61]])
    cash = -5487.668
    if field == "cash":
        cash -= 0.1
    elif field == "electricity":
        upper[0, 1] += 0.01
    else:
        upper[1, 0] = 0.01
    report = verify_solution(
        scenario, replace(feasible_values, electricity_cost=upper, cash_auxiliary=cash)
    )
    expected = "cash_lower_bound" if field == "cash" else "electricity_upper_bound"
    assert expected in {v.code for v in report.violations}


def test_valid_inbounds_slack_does_not_change_realized_cash(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    exact = verify_solution(scenario, feasible_values)
    bills = feasible_values.electricity_cost.copy()
    bills[0] += 0.5
    bills[1, 1:] += 0.5
    slack = verify_solution(
        scenario,
        replace(feasible_values, electricity_cost=bills, cash_auxiliary=-2000.0),
    )
    assert slack.ok, slack.violations
    np.testing.assert_array_equal(slack.cash.net_cash, exact.cash.net_cash)


def test_unaffordable_factory_restricts_later_electricity_auxiliary(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    limited = replace(scenario, central_allowance=np.zeros(3))
    bills = feasible_values.electricity_cost.copy()
    bills[1, 1] = 0.01
    report = verify_solution(limited, replace(feasible_values, electricity_cost=bills))
    assert "electricity_upper_bound" in {v.code for v in report.violations}


def test_cash_envelope_tracks_changed_maximum_salaries(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    salaries = scenario.salary.copy()
    salaries[0, 0] += 0.1
    changed = replace(scenario, salary=salaries)
    # Six maximum US researchers in each of three years increase envelope by 1.8.
    at_bound = verify_solution(
        changed, replace(feasible_values, cash_auxiliary=-5489.468)
    )
    assert at_bound.ok, at_bound.violations
    outside = verify_solution(
        changed, replace(feasible_values, cash_auxiliary=-5489.568)
    )
    assert "cash_lower_bound" in {v.code for v in outside.violations}


def test_exact_numeric_domain_envelopes(scenario: Scenario) -> None:
    from app.verification.domains import auxiliary_limits

    limits = auxiliary_limits(scenario)
    np.testing.assert_allclose(
        limits.electricity_cost_max,
        [[3.48, 4.98, 5.28], [0.0, 2.38, 2.61]],
        atol=1e-12,
        rtol=0,
    )
    assert limits.cash_min == pytest.approx(-5487.668, abs=1e-9, rel=0)


def test_electricity_domain_respects_labor_capacity(scenario: Scenario) -> None:
    from app.verification.domains import auxiliary_limits

    staffing = scenario.staff_max.copy()
    staffing[2, 1] = 5
    changed = replace(scenario, staff_max=staffing)
    limits = auxiliary_limits(changed)
    # Germany is labor-limited to 50 volume in each year despite possible capex.
    np.testing.assert_allclose(limits.electricity_cost_max[0], [1.8, 1.86, 1.92])
