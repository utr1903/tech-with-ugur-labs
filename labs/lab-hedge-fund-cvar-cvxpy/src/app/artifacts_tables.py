"""The two tables that describe the headline book, name by name and sector.

Both carry a column pair that is the whole point of this lab's care about
relaxations. `weights.csv` reports `name_gross_used`, which is
`l_i + s_i` — the expression `name_gross_cap` is written on — beside the
weight it bounds. `sectors.csv` reports `model_gross_row`, which is
`Msec @ (l + s)`, beside `book_gross`, which is `Msec @ |w|`. Wherever
the signed split is exact each pair coincides; where it has lapsed they
do not, and the file lets a reader see it rather than take it on trust.

A run whose headline produced no weights writes both files with their
header row and nothing else. The file list then stays the same whatever
the solver said, and an empty table is an honest report of an unreachable
mandate where a table of start weights would read as a book somebody
chose.
"""

from __future__ import annotations

import numpy as np

from app.artifacts_csv import table
from app.bundle import RunBundle
from app.contracts import PortfolioSolution, Universe

WEIGHT_COLUMNS = (
    "name",
    "sector",
    "start_weight",
    "weight",
    "trade",
    "long_leg",
    "short_leg",
    "market_beta",
    "borrow_fee_annual",
    "half_spread",
    "name_gross_used",
    "name_gross_cap",
)

SECTOR_COLUMNS = (
    "sector",
    "names",
    "book_net",
    "sector_net_cap",
    "book_gross",
    "model_gross_row",
    "sector_gross_cap",
)


def weights_csv(bundle: RunBundle) -> str:
    """Serialize one row per name, with the split the solver returned.

    A bundle whose headline carries no weights produces the header row and
    nothing else. That is deliberate: the file list stays the same whatever
    the solver said, and an empty table is an honest report of an
    infeasible mandate where a table of start weights would read as a book
    somebody chose.
    """
    universe = bundle.scenario.universe
    solution = bundle.headline.solution
    if solution is None:
        return table(WEIGHT_COLUMNS, [])
    cap = bundle.scenario.limits.name_gross_cap
    gross_leg = solution.long_leg + solution.short_leg
    rows = [
        [
            universe.names[index],
            universe.sectors[universe.sector_of[index]],
            float(universe.start_book[index]),
            float(solution.weights[index]),
            float(solution.weights[index] - universe.start_book[index]),
            float(solution.long_leg[index]),
            float(solution.short_leg[index]),
            float(universe.market_beta[index]),
            float(universe.borrow_fee_annual[index]),
            float(universe.half_spread[index]),
            float(gross_leg[index]),
            cap,
        ]
        for index in range(len(universe.names))
    ]
    return table(WEIGHT_COLUMNS, rows)


def _sector_rows(
    universe: Universe, solution: PortfolioSolution, *, net_cap: float, gross_cap: float
) -> list[list[object]]:
    """Measure each sector on the book and on the row the model constrains."""
    sector = universe.sector_matrix
    absolute = np.abs(solution.weights)
    gross_leg = solution.long_leg + solution.short_leg
    book_net = sector @ solution.weights
    book_gross = sector @ absolute
    model_row = sector @ gross_leg
    counts = sector.sum(axis=1)
    return [
        [
            name,
            int(counts[index]),
            float(book_net[index]),
            net_cap,
            float(book_gross[index]),
            float(model_row[index]),
            gross_cap,
        ]
        for index, name in enumerate(universe.sectors)
    ]


def sectors_csv(bundle: RunBundle) -> str:
    """Serialize the per-sector net and gross exposures against their caps."""
    solution = bundle.headline.solution
    if solution is None:
        return table(SECTOR_COLUMNS, [])
    limits = bundle.scenario.limits
    return table(
        SECTOR_COLUMNS,
        _sector_rows(
            bundle.scenario.universe,
            solution,
            net_cap=limits.sector_net_cap,
            gross_cap=limits.sector_gross_cap,
        ),
    )
