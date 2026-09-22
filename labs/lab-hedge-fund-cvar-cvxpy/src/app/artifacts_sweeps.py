"""The three tables that describe a sweep rather than a single book.

`frontier.csv` is where this lab's care about relaxations is easiest to
see. Every solved target carries `cvar_book_gross`, the portfolio's own
`sum |w|`, beside `cvar_model_gross_row`, the `sum(l + s)` the gross cap
is actually written on, and `cvar_split_overlap`, the worst name's
`min(l_i, s_i)`. Where the third is zero the first two coincide; where it
is not, they do not, and the file shows a reader exactly which targets
those are.

A target the mandate could not reach keeps the solver's status verbatim
and leaves every number of its row empty. Dropping the row instead would
make the file quietly answer a smaller question than it appears to.
"""

from __future__ import annotations

import numpy as np

from app.artifacts_csv import table
from app.contracts import DualRow, FrontierPoint, LadderRow
from app.lib.dual_verdicts import check_verdict
from app.limits import written_on

FRONTIER_COLUMNS = (
    "target_monthly",
    "cvar_status",
    "cvar_objective",
    "cvar_solve_seconds",
    "cvar_book_gross",
    "cvar_model_gross_row",
    "cvar_split_overlap",
    "variance_status",
    "variance_cvar",
)

ALGORITHM_COLUMNS = (
    "scenarios",
    "solver",
    "status",
    "objective",
    "solve_seconds",
    "iterations",
)

DUAL_COLUMNS = (
    "label",
    "written_on",
    "active",
    "dual_value",
    "finite_difference",
    "agrees",
    "check",
)


def _frontier_row(point: FrontierPoint) -> list[object]:
    """Serialize one swept target, both books and the split's exactness."""
    solution = point.cvar_outcome.solution
    if solution is None:
        return [
            point.target_monthly,
            point.cvar_outcome.status,
            None,
            point.cvar_outcome.solve_seconds,
            None,
            None,
            None,
            point.variance_outcome.status,
            point.cvar_of_variance_portfolio,
        ]
    gross_leg = solution.long_leg + solution.short_leg
    return [
        point.target_monthly,
        point.cvar_outcome.status,
        solution.objective,
        point.cvar_outcome.solve_seconds,
        float(np.abs(solution.weights).sum()),
        float(gross_leg.sum()),
        float(np.minimum(solution.long_leg, solution.short_leg).max()),
        point.variance_outcome.status,
        point.cvar_of_variance_portfolio,
    ]


def frontier_csv(points: tuple[FrontierPoint, ...]) -> str:
    """Serialize the swept frontier, infeasible targets included."""
    return table(FRONTIER_COLUMNS, [_frontier_row(point) for point in points])


def algorithms_csv(ladder: tuple[LadderRow, ...]) -> str:
    """Serialize the scenario-count by algorithm table."""
    return table(
        ALGORITHM_COLUMNS,
        [
            [
                entry.scenarios,
                entry.solver_name,
                entry.status,
                entry.objective,
                entry.solve_seconds,
                entry.iterations,
            ]
            for entry in ladder
        ],
    )


def duals_csv(duals: tuple[DualRow, ...]) -> str:
    """Serialize the shadow prices, each labelled with what it is written on.

    `agrees` is kept as the contract reports it and `check` says which of
    its two meanings applies — a row that was never checked because it is
    inactive, or an active row whose re-solve could not confirm the price.
    """
    return table(
        DUAL_COLUMNS,
        [
            [
                entry.label,
                written_on(entry.label),
                entry.active,
                entry.dual_value,
                entry.finite_difference,
                entry.agrees,
                check_verdict(entry),
            ]
            for entry in duals
        ],
    )
