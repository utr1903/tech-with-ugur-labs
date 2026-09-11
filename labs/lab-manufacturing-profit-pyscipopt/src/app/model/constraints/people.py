"""Conditional factory headcounts and regional support coverage."""

from __future__ import annotations

from pyscipopt import Model

from app.contracts import Scenario
from app.model.constraints.investments import factory_open
from app.model.variables import ModelVariables


def add_staffing_constraints(model: Model, v: ModelVariables, s: Scenario) -> None:
    """Manufacturing min*open <= people <= max*open; support covers teams."""
    opened = factory_open(v)
    model.addMatrixCons(
        v.headcount[2:, 1] >= s.staff_min[2:, 1] * opened, name="manufacturing_floor"
    )
    model.addMatrixCons(
        v.headcount[2:, 1] <= s.staff_max[2:, 1] * opened, name="manufacturing_ceiling"
    )
    model.addMatrixCons(
        v.headcount[:, 3]
        >= s.support_fixed + (s.support_ratios * v.headcount[:, :3]).sum(axis=1),
        name="support_coverage",
    )
