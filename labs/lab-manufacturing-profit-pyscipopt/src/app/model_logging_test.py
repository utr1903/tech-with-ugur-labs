"""Model setup logs expose the actual SCIP domains and installed equations."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest
from pyscipopt import Constraint, Model
from structlog.testing import capture_logs

from app.logging_setup import Logger
from app.model import build_model
from app.scenario import Scenario


@pytest.mark.parametrize("changed", [False, True])
def test_setup_logs_match_installed_model(
    scenario: Scenario, log: Logger, changed: bool
) -> None:
    """Every variable/constraint is explained once, including scenario overrides."""
    if changed:
        scenario = replace(
            scenario,
            demand_units=np.array([1500.0, 2750.0, 3800.0]),
            max_workers=7,
            units_per_worker_per_year=650.0,
            initial_unit_cost_usd=57.123456789,
            first_researcher_saving_usd_per_unit=5.25,
        )
    with capture_logs() as events:
        built = build_model(scenario, log=log)
    domains = [
        event for event in events if event["event"] == "Creating variable succeeded."
    ]
    assert len(domains) == 16
    by_name = {event["name"]: event for event in domains}
    for variable in built.model.getVars():
        event = by_name[variable.name]
        assert event["lower_bound"] == variable.getLbOriginal()
        assert event["upper_bound"] == variable.getUbOriginal()
        assert event["variable_type"] == variable.vtype()
        assert event["log_level"] == "info"
    constraints = [
        event for event in events if event["event"] == "Adding constraint succeeded."
    ]
    assert len(constraints) == 14
    by_constraint = {event["name"]: event for event in constraints}
    values = {
        variable.name: float(index + 2)
        for index, variable in enumerate(built.model.getVars())
    }
    for constraint in built.model.getConss():
        event = by_constraint[constraint.name]
        assert event["lower_bound"] == (
            None
            if built.model.isInfinity(-built.model.getLhs(constraint))
            else built.model.getLhs(constraint)
        )
        assert event["upper_bound"] == (
            None
            if built.model.isInfinity(built.model.getRhs(constraint))
            else built.model.getRhs(constraint)
        )
        # Evaluate only our generated polynomial with locally constructed values.
        # Compare against independently read SCIP linear/quadratic coefficients.
        polynomial = event["expression"].split(" <= ")[0].split(" == ")[0]
        assert eval(polynomial, {"__builtins__": {}}, values) == pytest.approx(
            _installed_activity(built.model, constraint, values)
        )
        assert event["log_level"] == "info"
    worker_capacity = scenario.units_per_worker_per_year
    assert by_constraint["staffing_year_1"]["expression"] == (
        f"1 * units_produced_0 - {worker_capacity:g} * workers_0 <= 0"
    )
    assert by_constraint["initial_unit_cost"]["expression"] == (
        "1 * unit_cost_0 == " + repr(scenario.initial_unit_cost_usd).removesuffix(".0")
    )
    objectives = [
        event for event in events if event["event"] == "Setting objective succeeded."
    ]
    assert len(objectives) == 1
    assert objectives[0]["sense"] == built.model.getObjectiveSense()
    assert objectives[0]["expression"] == "1 * cash_auxiliary"


def test_rejected_constraint_has_no_success_event(log: Logger) -> None:
    """SCIP rejection propagates without claiming the equation was installed."""
    from app.model_logging import add_constraint

    model = Model()
    model.hideOutput()
    variable = model.addVar("late_variable")
    expression = variable <= 1
    model.optimize()
    with capture_logs() as events, pytest.raises(Exception, match="cannot be called"):
        add_constraint(model, expression, name="rejected", log=log)
    assert not any(event["event"] == "Adding constraint succeeded." for event in events)
    assert events[-1]["event"] == "Adding constraint failed."


def _installed_activity(
    model: Model, constraint: Constraint, values: dict[str, float]
) -> float:
    """Evaluate SCIP's installed coefficients independently of log formatting."""
    if constraint.isLinear():
        return sum(
            float(coefficient) * values[name]
            for name, coefficient in model.getValsLinear(constraint).items()
        )
    bilinear, quadratic, linear = model.getTermsQuadratic(constraint)
    return (
        sum(float(coef) * values[x.name] * values[y.name] for x, y, coef in bilinear)
        + sum(
            float(square) * values[x.name] ** 2 + float(coef) * values[x.name]
            for x, square, coef in quadratic
        )
        + sum(float(coef) * values[x.name] for x, coef in linear)
    )
