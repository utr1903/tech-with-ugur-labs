"""Finite variable domains in annual pump volumes and millions of USD."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, cast

import numpy as np
from pyscipopt import MatrixVariable, Model, Variable

from app.contracts import DerivedBounds, FloatArray, Scenario


@dataclass(frozen=True)
class ModelVariables:
    """Symbolic object arrays with the same axes as DecisionValues."""

    headcount: MatrixVariable
    investment_start: MatrixVariable
    rd_allocation: MatrixVariable
    process_saving: MatrixVariable
    development_stock: MatrixVariable
    product_active: MatrixVariable
    sales_share: MatrixVariable
    price: MatrixVariable
    sales: MatrixVariable
    production: MatrixVariable
    shipment: MatrixVariable
    electricity_use: MatrixVariable
    electricity_cost: MatrixVariable
    cash_auxiliary: Variable


def matrix_variable(
    model: Model,
    name: str,
    upper: FloatArray,
    *,
    lower: FloatArray | float = 0.0,
    kind: Literal["C", "I", "B"] = "C",
) -> MatrixVariable:
    """Narrow addMatrixVar's incomplete return stub to its public runtime type."""
    return cast(
        MatrixVariable,
        model.addMatrixVar(
            shape=upper.shape,
            name=name,
            vtype=kind,
            lb=lower,
            ub=upper,
        ),
    )


def _rd_upper(scenario: Scenario) -> FloatArray:
    maximum = np.zeros((4, 3, 3), dtype=np.float64)
    alpha = scenario.rd_alpha + scenario.rd_upgrade_alpha_gain[:, None]
    staff = np.minimum(alpha / (2 * scenario.rd_beta), scenario.staff_max[:2, 0])
    capacity = alpha * staff - scenario.rd_beta * staff**2
    maximum[:2] = capacity[:, None, :]
    return maximum


def create_variables(
    model: Model, scenario: Scenario, bounds: DerivedBounds
) -> ModelVariables:
    """Create finite integer people, binary starts/activity, and continuous flows."""
    headcount_lower = scenario.staff_min.copy()
    headcount_lower[3, 1] = 0  # China manufacturing floors depend on opening.
    start_upper = np.ones((4, 3), dtype=np.float64)
    start_upper[:, -1] = 0
    production_upper = np.minimum(
        bounds.production_max[:, None, :],
        bounds.demand_max.sum(axis=0)[None, :, :],
    )
    shipment_upper = np.minimum(
        production_upper[:, None, :, :],
        bounds.demand_max[None, :, :, :],
    )
    return ModelVariables(
        headcount=matrix_variable(
            model, "headcount", scenario.staff_max, lower=headcount_lower, kind="I"
        ),
        investment_start=matrix_variable(
            model, "investment_start", start_upper, kind="B"
        ),
        rd_allocation=matrix_variable(model, "rd_allocation", _rd_upper(scenario)),
        process_saving=matrix_variable(
            model, "process_saving", np.full(3, scenario.max_process_saving)
        ),
        development_stock=matrix_variable(
            model, "development_stock", np.full(3, scenario.max_development_stock)
        ),
        product_active=matrix_variable(model, "product_active", np.ones(3), kind="B"),
        sales_share=matrix_variable(model, "sales_share", np.ones((4, 2, 3))),
        price=matrix_variable(
            model, "price", scenario.price_max, lower=scenario.price_min
        ),
        sales=matrix_variable(model, "sales", bounds.demand_max),
        production=matrix_variable(model, "production", production_upper),
        shipment=matrix_variable(model, "shipment", shipment_upper),
        electricity_use=matrix_variable(
            model, "electricity_use", bounds.electricity_max
        ),
        electricity_cost=matrix_variable(
            model,
            "electricity_cost",
            bounds.electricity_max * scenario.tariff.marginal_rates[:, -1, None],
        ),
        cash_auxiliary=cast(
            Variable,
            model.addVar(
                name="cash_auxiliary",
                lb=-bounds.cash_abs_max,
                ub=float(np.sum(scenario.price_max * bounds.demand_max)),
            ),
        ),
    )
