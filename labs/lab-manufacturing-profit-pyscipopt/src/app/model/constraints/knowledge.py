"""Concave R&D capacity and persistent process/development stocks."""

from __future__ import annotations

from pyscipopt import Model

from app.contracts import DerivedBounds, Scenario
from app.model.constraints.investments import availability
from app.model.variables import ModelVariables, matrix_variable


def add_rd_constraints(model: Model, v: ModelVariables, s: Scenario) -> None:
    """Allocated capability <= alpha*n - beta*n² + upgrade_gain*(U*n)."""
    people = v.headcount[:2, 0]
    upgrade = availability(v)[:2]
    lower, upper = s.staff_min[:2, 0], s.staff_max[:2, 0]
    upgraded_people = matrix_variable(model, "upgraded_rd_people", upper)
    # Exact binary-times-bounded-integer hull: w = U*n with U in {0,1}.
    model.addMatrixCons(upgraded_people >= lower * upgrade, name="rd_upgrade_lower")
    model.addMatrixCons(upgraded_people <= upper * upgrade, name="rd_upgrade_upper")
    model.addMatrixCons(
        upgraded_people >= people - upper * (1 - upgrade), name="rd_upgrade_link_lower"
    )
    model.addMatrixCons(
        upgraded_people <= people - lower * (1 - upgrade), name="rd_upgrade_link_upper"
    )
    output = (
        s.rd_alpha * people
        - s.rd_beta * people**2
        + s.rd_upgrade_alpha_gain[:, None] * upgraded_people
    )
    model.addMatrixCons(v.rd_allocation[:2].sum(axis=1) <= output, name="rd_capacity")


def add_knowledge_constraints(
    model: Model,
    v: ModelVariables,
    s: Scenario,
    bounds: DerivedBounds,
) -> None:
    """Lagged saving/stock equalities and high-product capability/volume gates."""
    model.addCons(
        v.process_saving[0] == s.initial_process_saving, name="initial_saving"
    )
    model.addCons(
        v.development_stock[0] == s.initial_development_stock,
        name="initial_development",
    )
    # Year-three process/development allocations remain legal, with no later payoff.
    model.addMatrixCons(
        v.process_saving[1:]
        == v.process_saving[:-1]
        + s.process_conversion[:-1] * v.rd_allocation[:, 0, :-1].sum(axis=0),
        name="process_accumulation",
    )
    model.addMatrixCons(
        v.development_stock[1:]
        == v.development_stock[:-1] + v.rd_allocation[:, 1, :-1].sum(axis=0),
        name="development_accumulation",
    )
    model.addMatrixCons(
        v.development_stock >= s.development_threshold * v.product_active,
        name="development_gate",
    )
    model.addMatrixCons(
        v.rd_allocation[:, 2].sum(axis=0) >= s.maintenance_required * v.product_active,
        name="maintenance_gate",
    )
    model.addMatrixCons(
        v.production[:, 1].sum(axis=0) <= bounds.high_production_max * v.product_active,
        name="high_production_gate",
    )
    model.addMatrixCons(
        v.sales[:, 1] <= bounds.demand_max[:, 1] * v.product_active[None, :],
        name="high_sales_gate",
    )
