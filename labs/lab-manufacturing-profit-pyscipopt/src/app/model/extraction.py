"""Immutable numeric values from one explicitly selected feasible solution."""

from __future__ import annotations

import numpy as np
from pyscipopt import MatrixVariable, Model
from pyscipopt.scip import Solution

from app.contracts import DecisionValues, FloatArray
from app.model.variables import ModelVariables


def _values(model: Model, solution: Solution, variables: MatrixVariable) -> FloatArray:
    result = np.array(model.getSolVal(solution, variables), dtype=np.float64, copy=True)
    result.flags.writeable = False
    return result


def extract_decisions(
    model: Model, solution: Solution, v: ModelVariables
) -> DecisionValues:
    """Read every field from the exact best-solution object, never current values."""
    return DecisionValues(
        headcount=_values(model, solution, v.headcount),
        investment_start=_values(model, solution, v.investment_start),
        rd_allocation=_values(model, solution, v.rd_allocation),
        process_saving=_values(model, solution, v.process_saving),
        development_stock=_values(model, solution, v.development_stock),
        product_active=_values(model, solution, v.product_active),
        sales_share=_values(model, solution, v.sales_share),
        price=_values(model, solution, v.price),
        sales=_values(model, solution, v.sales),
        production=_values(model, solution, v.production),
        shipment=_values(model, solution, v.shipment),
        electricity_use=_values(model, solution, v.electricity_use),
        electricity_cost=_values(model, solution, v.electricity_cost),
        cash_auxiliary=float(model.getSolVal(solution, v.cash_auxiliary)),
    )
