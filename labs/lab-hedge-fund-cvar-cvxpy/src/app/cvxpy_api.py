"""The one module that touches CVXPY's two untyped functions.

`cvxpy.Problem.solve` and `cvxpy.installed_solvers` carry no annotations,
so `mypy --strict`'s `disallow_untyped_calls` rejects every call to them.
That flag is evaluated against the *calling* file, so it cannot be scoped
to `cvxpy.*`. Confining both calls here means one narrowly-scoped override
instead of one per solving module, and every other module in the app stays
fully strict — the same reasoning that puts the codebase's only `cast` in
`get_logger` (see the `python-logging` skill).

Every other module that needs to solve a problem or list solvers imports
these two wrappers instead of calling `cvxpy.Problem.solve` or
`cvxpy.installed_solvers` directly.
"""

from __future__ import annotations

import cvxpy as cp


def installed_solvers() -> tuple[str, ...]:
    """Returns the solver names CVXPY can actually reach in this install."""
    return tuple(cp.installed_solvers())


def solve(problem: cp.Problem, *, solver: str, **options: object) -> None:
    """Solves `problem` in place with the named solver and its options."""
    problem.solve(solver=solver, **options)
