from __future__ import annotations

from copy import deepcopy
from dataclasses import replace

import numpy as np
import pytest

from app.contracts import DecisionValues, Scenario
from app.verification import verify_solution


def test_feasible_zero_volume_plan_cash(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    report = verify_solution(scenario, feasible_values)
    assert report.ok, report.violations
    np.testing.assert_allclose(report.cash.electricity, [0.25, 0.275, 0.3])
    np.testing.assert_allclose(
        report.cash.salaries,
        np.sum(scenario.salary * feasible_values.headcount, axis=(0, 1)),
    )
    np.testing.assert_allclose(
        report.cash.net_cash, -report.cash.salaries - 5.3 - 4 - report.cash.electricity
    )


@pytest.mark.parametrize(
    ("field", "index", "value", "code"),
    [
        ("shipment", (0, 0, 0, 0), 0.25, "production_outbound_balance"),
        ("headcount", (0, 0, 0), 2.5, "integrality"),
        ("headcount", (0, 0, 0), 10, "staff_max"),
        ("headcount", (0, 3, 0), 0, "support_coverage"),
        ("investment_start", (0, 2), 1, "investment_final_year"),
        ("investment_start", (3, 0), 2, "investment_once"),
        ("rd_allocation", (0, 0, 0), 100, "rd_capacity"),
        ("rd_allocation", (2, 0, 0), 1, "rd_region"),
        ("process_saving", (1,), 0.1, "process_recurrence"),
        ("development_stock", (1,), 1, "development_recurrence"),
        ("product_active", (0,), 1, "development_prerequisite"),
        ("product_active", (1,), 1, "maintenance"),
        ("production", (1, 0, 0), 1, "factory_capacity"),
        ("production", (0, 1, 0), 1, "high_production_activity"),
        ("sales_share", (0, 0, 0), 1, "sales_effort"),
        ("sales", (0, 0, 0), 1000, "demand"),
        ("sales", (0, 1, 0), 1, "high_sales_activity"),
        ("price", (0, 0, 0), 100, "price_max"),
        ("electricity_cost", (0, 0), 0, "electricity_epigraph"),
        ("electricity_use", (0, 0), 0, "electricity_use"),
    ],
)
def test_mutations(
    scenario: Scenario,
    feasible_values: DecisionValues,
    field: str,
    index: tuple[int, ...],
    value: float,
    code: str,
) -> None:
    array = getattr(feasible_values, field).copy()
    array[index] = value
    report = verify_solution(scenario, replace(feasible_values, **{field: array}))
    assert code in {v.code for v in report.violations}


@pytest.mark.parametrize(
    "field",
    [
        "headcount",
        "investment_start",
        "rd_allocation",
        "process_saving",
        "development_stock",
        "product_active",
        "sales_share",
        "price",
        "sales",
        "production",
        "shipment",
        "electricity_use",
        "electricity_cost",
    ],
)
@pytest.mark.parametrize("kind", ["shape", "nan", "inf"])
def test_malformed_decisions(
    scenario: Scenario, feasible_values: DecisionValues, field: str, kind: str
) -> None:
    array = np.zeros(1) if kind == "shape" else getattr(feasible_values, field).copy()
    if kind != "shape":
        array.flat[0] = float(kind)
    bad = deepcopy(feasible_values)
    object.__setattr__(bad, field, array)
    assert not verify_solution(scenario, bad).ok


def test_slack_auxiliaries_and_cash_violation(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    bills = feasible_values.electricity_cost.copy()
    bills[0] += 1
    bills[1, 1:] += 1
    assert verify_solution(
        scenario, replace(feasible_values, electricity_cost=bills)
    ).ok
    assert "cash_auxiliary" in {
        v.code
        for v in verify_solution(
            scenario, replace(feasible_values, cash_auxiliary=1)
        ).violations
    }
    assert not verify_solution(
        scenario, replace(feasible_values, cash_auxiliary=float("nan"))
    ).ok


def test_budget_and_allowance(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    limited = replace(
        scenario, regional_budget=np.zeros((4, 3)), central_allowance=np.zeros(3)
    )
    starts = feasible_values.investment_start.copy()
    starts[0, 0] = 1
    codes = {
        v.code
        for v in verify_solution(
            limited, replace(feasible_values, investment_start=starts)
        ).violations
    }
    assert {"regional_budget", "central_allowance"} <= codes


def test_nonzero_cash_costs(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    d = feasible_values
    d.production[0, 0] = 10
    d.shipment[0, 0, 0] = 10
    d.sales[0, 0] = 10
    d.electricity_use[0] = [70, 75, 80]
    d.electricity_cost[0] = [0.35, 0.375, 0.4]
    report = verify_solution(scenario, d)
    assert report.ok, report.violations
    np.testing.assert_allclose(report.cash.revenue, [12, 12, 12])
    np.testing.assert_allclose(report.cash.materials, [1.9, 1.9, 1.9])
    np.testing.assert_allclose(report.cash.shipping, [0.5, 0.5, 0.5])
    np.testing.assert_allclose(
        report.cash.net_cash,
        12 - report.cash.salaries - 1.9 - 0.5 - 5.3 - 4 - np.array([0.35, 0.375, 0.4]),
    )


def test_extreme_finite_decisions_rejected_without_overflow(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    d = feasible_values
    d.headcount[:] = 1e308
    with np.errstate(over="raise", invalid="raise"):
        assert not verify_solution(scenario, d).ok


def test_tariff_breakpoints_and_upper_block(scenario: Scenario) -> None:
    from app.verification.cash import exact_tariff

    energy = np.array([[100.0, 250.0, 300.0], [100.0, 250.0, 300.0]])
    np.testing.assert_allclose(
        exact_tariff(scenario, energy), [[0.5, 1.7, 2.3], [0.4, 1.3, 1.8]]
    )


def test_relative_and_integrality_tolerances(
    scenario: Scenario, feasible_values: DecisionValues
) -> None:
    d = feasible_values
    d.electricity_use[0, 0] += 0.00002
    assert verify_solution(scenario, d).ok
    d.headcount[0, 0, 0] += 0.000002
    assert "integrality" in {v.code for v in verify_solution(scenario, d).violations}
