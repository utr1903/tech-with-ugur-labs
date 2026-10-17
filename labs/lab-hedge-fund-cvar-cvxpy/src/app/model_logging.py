"""One JSON line per decision variable and per constraint family.

A built optimization problem is the least inspectable object in a lab like
this one: by the time it reaches a solver it is a sparse matrix, and if a
constraint was declared with the wrong sign or the wrong shape there is
nothing in the output that says so. These two helpers print the model's
skeleton at build time, so a reader comparing the log against the algebra
in the README can see every row that went in.

Both are read-only: they look at CVXPY objects and never touch them.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

import cvxpy as cp

from app.cvxpy_api import is_parameterized
from app.logging_setup import Logger


def _sense_of(constraint: cp.Constraint) -> str:
    """Return the constraint's normalized sense.

    CVXPY rewrites every inequality into the form `args[0] <= args[1]`, so
    a constraint written `x >= 3` arrives here as `3 <= x`. The sense
    reported is therefore always the normalized one, which is also the form
    the solver sees.
    """
    return "==" if isinstance(constraint, cp.constraints.Equality) else "<="


def _bound_of(constraint: cp.Constraint) -> float | None:
    """Return the scalar limit on one side of the constraint, if there is one.

    `None` covers the two cases where no such number exists: a family that
    relates variables to each other, such as `w == l - s`, and the return
    target, whose right-hand side is a parameter with no value until a
    caller sets one.
    """
    for argument in constraint.args:
        if argument.is_constant() and argument.size == 1:
            value = argument.value
            if value is not None:
                return float(value)
    return None


def log_variables(variables: Sequence[cp.Variable], *, kind: str, log: Logger) -> None:
    """Log the shape and sign of each decision variable in a built model."""
    for variable in variables:
        log.info(
            "Declared a model variable.",
            kind=kind,
            name=variable.name(),
            shape=list(variable.shape),
            is_nonneg=bool(variable.is_nonneg()),
        )


def log_constraint_families(
    families: Mapping[str, cp.Constraint], *, kind: str, log: Logger
) -> None:
    """Log the sense, shape and bound of each constraint family."""
    for label, constraint in families.items():
        log.info(
            "Declared a constraint family.",
            kind=kind,
            label=label,
            shape=list(constraint.shape),
            sense=_sense_of(constraint),
            bound=_bound_of(constraint),
            is_parameterized=is_parameterized(constraint),
        )
