"""What the run looks like on a terminal: the lab's primary reader surface.

Everything printed here goes through `output.write_line`, which is the
app's only sanctioned writer of human-facing text. The JSON log on the
same stream is for machines; these tables are for people, and the two
never mix formats.

**The status is whatever the solver said.** `optimal_inaccurate` prints as
`optimal_inaccurate`, never as `optimal` and never as a warning dressed up
as success — a reader deciding whether to trust a book is entitled to know
the method stopped short of its own tolerance. And a headline that came
back `infeasible` prints its status and then nothing else about a book,
because there is no book: the mandate could not deliver the required
return at any level of risk, which is a result and not a crash.

**Two decimals here, raw floats in `output/`.** The console is for reading
and the CSVs beside it are for recomputing, so nothing rounded here is
lost — `console_format.py` owns both that rule and the units.

This file runs a little past the ~200-line target the lab holds its
modules to, on prose rather than code: about 165 lines are executable.
The tables it does not own have already been lifted into
`console_tables.py`, `console_prices.py` and `console_compare.py`; what
is left is the header, the status and the one table that needs the
weights.
"""

from __future__ import annotations

from app.bundle import RunBundle
from app.console_compare import print_algorithms, print_frontier, print_models
from app.console_format import (
    ABSENT,
    basis_points,
    nav_percent,
    optional_count,
    row,
    rule,
    seconds,
)
from app.console_prices import print_duals
from app.console_tables import print_exposures, print_ledger, print_tails
from app.contracts import PortfolioSolution, Universe
from app.output import write_line
from app.tailrisk import tail_count

# The desk the scenario describes. The universe is invented and so is the
# fund; the name is here so the report reads as one book's report rather
# than as a pile of tables.
FUND_NAME = "Long/short equity fund"

# A name is listed individually when its weight or its trade is at least
# this large in absolute value. Everything below it is summed into one
# row, so the table is short without hiding any mass.
DISPLAY_THRESHOLD = 0.005

BANNER_WIDTH = 78
_BOOK_WIDTHS = (8, 14, 9, 9, 9)


def print_report(bundle: RunBundle) -> None:
    """Print the whole run as reader-facing tables.

    Args:
        bundle: One complete run. A bundle whose headline carries no
            solution prints its header, its status and the parts of the
            report that do not describe a book.
    """
    _print_header(bundle)
    _print_solve(bundle)
    solution = bundle.headline.solution
    report = bundle.verification
    if solution is not None and report is not None:
        _print_book(bundle.scenario.universe, solution)
        print_exposures(bundle.scenario, solution)
        print_ledger(report, target=bundle.scenario.headline_target_monthly)
        print_tails(report, beta=bundle.scenario.cvar_beta, optimism=bundle.optimism)
        print_duals(bundle.duals, report, bundle.scenario.limits)
    print_models(
        bundle.elliptical,
        bundle.frontier,
        study_scenarios=bundle.scenario.studies.scenarios,
    )
    print_algorithms(bundle.ladder)
    print_frontier(bundle.frontier)


def _print_header(bundle: RunBundle) -> None:
    """Name the fund, the market it was measured in and the tail it minimizes."""
    scenario, market = bundle.scenario, bundle.market
    in_sample = int(market.returns.shape[0])
    write_line("=" * BANNER_WIDTH)
    write_line(
        f"{FUND_NAME} -- {scenario.cvar_beta * 100:.0f}% CVaR portfolio construction"
    )
    write_line("=" * BANNER_WIDTH)
    write_line(
        f"  universe         {len(scenario.universe.names)} names in "
        f"{len(scenario.universe.sectors)} sectors"
    )
    write_line(
        f"  market           {market.mode}, {in_sample} scenarios, seed {market.seed}"
    )
    write_line(
        f"  out of sample    {bundle.out_of_sample.mode}, "
        f"{int(bundle.out_of_sample.returns.shape[0])} scenarios, "
        f"seed {bundle.out_of_sample.seed}"
    )
    write_line(f"  in-sample digest {market.digest}")
    write_line(f"  scenario digest  {bundle.scenario_digest}")
    write_line(
        f"  tail             worst "
        f"{tail_count(in_sample, scenario.cvar_beta)} of {in_sample} scenarios"
    )
    write_line(
        f"  return target    "
        f"{basis_points(scenario.headline_target_monthly)} bp per month, "
        f"net of borrow and trading cost"
    )
    write_line()


def _print_solve(bundle: RunBundle) -> None:
    """Print the solver's own verdict, verbatim, and what it cost."""
    outcome = bundle.headline
    write_line("Solve")
    write_line(f"  status           {outcome.status}")
    write_line(f"  solver           {outcome.solver_name}")
    write_line(
        f"  wall clock       {seconds(outcome.solve_seconds)} s over "
        f"{optional_count(outcome.iterations)} iterations"
    )
    solution = outcome.solution
    if solution is None:
        write_line(
            f"  The mandate cannot deliver a net "
            f"{basis_points(bundle.scenario.headline_target_monthly)} bp a month "
            f"at any level of risk,"
        )
        write_line("  so this run has no book to report and no limits to price.")
    else:
        write_line(
            f"  objective        {basis_points(solution.objective)} bp of NAV"
            "   (the monthly CVaR the model minimized)"
        )
    write_line()


def _book_line(
    name: str, sector: str, start: float, weight: float, trade: float
) -> str:
    """Lay out one line of the weight table, in percent of NAV."""
    return row(
        [
            name,
            sector,
            nav_percent(start),
            nav_percent(weight),
            nav_percent(trade),
        ],
        _BOOK_WIDTHS,
    )


def _shown(universe: Universe, solution: PortfolioSolution) -> list[int]:
    """Return the indices of the names worth a line of their own."""
    return [
        index
        for index in range(len(universe.names))
        if abs(solution.weights[index]) >= DISPLAY_THRESHOLD
        or abs(solution.weights[index] - universe.start_book[index])
        >= DISPLAY_THRESHOLD
    ]


def _print_book(universe: Universe, solution: PortfolioSolution) -> None:
    """Print the optimal book, with everything small folded into one row.

    The folded row and the total row both carry signed sums, so a reader
    can add the column up: nothing the optimizer decided is left out of
    the table, it is only left out of its own line.
    """
    weights, start = solution.weights, universe.start_book
    trades = weights - start
    shown = _shown(universe, solution)
    hidden = [index for index in range(len(universe.names)) if index not in shown]
    write_line(
        f"Optimal book, in % of NAV -- {len(shown)} of {len(universe.names)} "
        f"names listed"
    )
    write_line(
        f"  a name is listed when its weight or its trade reaches "
        f"{nav_percent(DISPLAY_THRESHOLD)} of NAV;"
    )
    write_line("  the rest are summed into one row so no mass is hidden.")
    write_line(row(["name", "sector", "start", "weight", "trade"], _BOOK_WIDTHS))
    write_line(rule(_BOOK_WIDTHS))
    for index in shown:
        write_line(
            _book_line(
                universe.names[index],
                universe.sectors[universe.sector_of[index]],
                float(start[index]),
                float(weights[index]),
                float(trades[index]),
            )
        )
    write_line(rule(_BOOK_WIDTHS))
    write_line(
        _book_line(
            "other",
            f"{len(hidden)} names",
            float(start[hidden].sum()),
            float(weights[hidden].sum()),
            float(trades[hidden].sum()),
        )
    )
    write_line(
        _book_line(
            "all",
            f"{len(universe.names)} names",
            float(start.sum()),
            float(weights.sum()),
            float(trades.sum()),
        )
    )
    write_line("  the last two rows are signed sums, so each column adds up.")
    write_line()


def print_absent(label: str) -> None:
    """Print a labelled line for a figure this run did not produce."""
    write_line(f"  {label}: {ABSENT}")
