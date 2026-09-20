"""The one module that touches the corners of CVXPY mypy cannot see.

Most of CVXPY type-checks cleanly. A handful of entry points do not, for
two separate reasons, and both are reported against the *calling* file
rather than against `cvxpy`, so neither can be scoped to `cvxpy.*`:

* `Problem.solve`, `installed_solvers`, `Canonical.parameters` and `cvar`
  carry no annotations, so `--strict`'s `disallow_untyped_calls` rejects
  every call to them.
* `Problem.is_dcp` *is* annotated `(self, dpp: bool = False) -> bool`, but
  it is wrapped in CVXPY's `compute_once` memoization decorator, which is
  declared as `Callable[[T], R] -> Callable[[T], R]`. That signature has
  room for `self` and nothing else, so as far as mypy is concerned the
  `dpp` argument does not exist and `is_dcp(dpp=True)` is a bad call.

Confining all of them here means two narrowly-scoped overrides on one
forty-line file of wrappers instead of one per solving module, and every
other module in the app stays fully strict — the same reasoning that puts
the codebase's only `cast` in `get_logger` (see the `python-logging`
skill).

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
    """
    return problem.is_dcp(dpp=True)


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
