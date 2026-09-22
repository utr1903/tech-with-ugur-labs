"""The one module that touches CVXPY's unannotated entry points.

Most of CVXPY type-checks cleanly. Four entry points carry no annotations
at all — `Problem.solve`, `installed_solvers`, `Canonical.parameters` and
`cvar` — so `mypy --strict`'s `disallow_untyped_calls` rejects every call
to them. That flag is evaluated against the *calling* file, so it cannot
be scoped to `cvxpy.*`. Confining all four here means one narrowly-scoped
override on one short file of wrappers instead of one per solving module,
and every other module in the app stays fully strict — the same reasoning
that puts the codebase's only `cast` in `get_logger` (see the
`python-logging` skill).

Every other module imports the wrappers below rather than reaching for
the CVXPY entry points they cover.
"""

from __future__ import annotations

import cvxpy as cp


def installed_solvers() -> tuple[str, ...]:
    """Returns the solver names CVXPY can actually reach in this install."""
    return tuple(cp.installed_solvers())


def solve(problem: cp.Problem, *, solver: str, **options: object) -> None:
    """Solves `problem` in place with the named solver and its options."""
    problem.solve(solver=solver, **options)


def is_dpp(problem: cp.Problem) -> bool:
    """Does `problem` obey the DPP ruleset as well as the DCP one?

    DPP is what lets a problem holding a `Parameter` be compiled once and
    re-solved at many parameter values, which is how the lab sweeps a
    return target without rebuilding the model twenty-five times.

    `problem.is_dpp()` and not the more familiar `problem.is_dcp(dpp=True)`
    — they are the same test, and CVXPY's own documentation says so, but
    only the first one type-checks. `is_dcp` is annotated
    `(self, dpp: bool = False) -> bool`, then memoized by a `compute_once`
    decorator declared `Callable[[T], R] -> Callable[[T], R]`: a signature
    with room for `self` and nothing else. mypy therefore believes `is_dcp`
    takes no arguments and rejects `dpp=True` outright. `is_dpp` takes its
    context as a defaulted argument this wrapper never passes, so the same
    erasure leaves it callable. Do not "simplify" this back.
    """
    return problem.is_dpp()


def is_parameterized(constraint: cp.Constraint) -> bool:
    """Does `constraint` depend on at least one `Parameter`?"""
    return bool(constraint.parameters())


def cvar(samples: cp.Expression, beta: float) -> cp.Expression:
    """Return CVXPY's own tail-average atom over a vector of samples.

    CVXPY expands this to `sum_largest(samples, (1 - beta) * m) / ((1 -
    beta) * m)`, interpolating when that count is fractional.
    """
    # Annotated on the way out rather than returned straight through:
    # `cvar` is untyped, so its result arrives as `Any` and returning it
    # unnamed would quietly widen every caller.
    atom: cp.Expression = cp.cvar(samples, beta)
    return atom
