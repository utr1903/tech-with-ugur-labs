"""The three comparisons: two models, three algorithms, twenty-five targets.

Each of these answers a question a sceptical reader should be asking.

*Why not just run Markowitz?* The elliptical study. If returns were
elliptical the two programs would be the same program, so the lab measures
how far apart the two books actually are in a Gaussian control and in the
fat-tailed market, and reports the ratio the study computed rather than
one formed here.

*Is this answer an artifact of the solver?* The algorithm ladder. The same
linear program under an interior-point method, a simplex method and a
second interior-point method, at several sample sizes.

*Is one portfolio an anecdote?* The frontier sweep. Feasible and
infeasible target counts are reported verbatim — a target the mandate
cannot reach is a result, not a failure, and the point carries no book.

Nothing in this module forms a ratio or an order of magnitude of its own.
Where a multiple appears on the console it was computed in `studies.py`
and is printed as it arrived.

This file runs a little past the ~200-line target the lab holds its
modules to: about 180 lines are executable, laid out as three short
sections that share one summary-line helper. Splitting them would put
three near-identical five-line modules where one readable file is.
"""

from __future__ import annotations

from app.console_format import (
    ABSENT,
    basis_points,
    optional_count,
    row,
    rule,
    seconds,
)
from app.contracts import FrontierPoint, LadderRow
from app.output import write_line
from app.studies import EllipticalResult

_LADDER_WIDTHS = (11, 16, 20, 12, 10, 11)
_FIELD_WIDTH = 38


def _field(label: str, value: str, note: str = "") -> str:
    """Lay out one `label ... value note` line of a summary block."""
    return f"  {label.ljust(_FIELD_WIDTH)}{value:>12}{'   ' + note if note else ''}"


def _variance_penalty(points: tuple[FrontierPoint, ...]) -> list[tuple[float, float]]:
    """Return `(target, extra CVaR)` for every point where both books solved.

    The penalty is the variance book's CVaR minus the CVaR book's, both
    measured on the same empirical tail of the same matrix, so it is what
    choosing the wrong objective costs at that target.
    """
    penalties = []
    for point in points:
        chosen = point.cvar_outcome.solution
        scored = point.cvar_of_variance_portfolio
        if chosen is None or scored is None:
            continue
        penalties.append((point.target_monthly, scored - chosen.objective))
    return penalties


def print_models(
    elliptical: EllipticalResult,
    points: tuple[FrontierPoint, ...],
    *,
    study_scenarios: int,
) -> None:
    """Print what minimizing the tail buys over minimizing variance.

    Args:
        elliptical: The seed-averaged study, including the ratio it formed.
        points: The frontier, for the same comparison target by target.
        study_scenarios: The per-seed sample size the study ran at, which
            every distance below is a measurement at.
    """
    write_line("CVaR against mean-variance")
    write_line(
        "  If returns were elliptical -- a normal, a Student-t -- then at a fixed"
    )
    write_line(
        "  expected return, minimizing CVaR and minimizing variance would be the same"
    )
    write_line(
        "  problem. The Gaussian arm below is the control that says the measurement"
    )
    write_line("  works; the fat-tailed arm is the market the fund actually faces.")
    write_line(
        _field(
            "seeds averaged",
            str(elliptical.seeds),
            f"at {study_scenarios} scenarios each",
        )
    )
    write_line(
        _field(
            "L1 book distance, gaussian control",
            f"{elliptical.gaussian_weight_distance:.4f}",
            "of NAV",
        )
    )
    write_line(
        _field(
            "L1 book distance, fat-tailed",
            f"{elliptical.fat_tailed_weight_distance:.4f}",
            "of NAV",
        )
    )
    write_line(
        _field(
            "divergence ratio",
            f"{elliptical.divergence_ratio:.3f}",
            "fat-tailed distance / control",
        )
    )
    write_line(
        _field(
            "out-of-sample CVaR gap, gaussian",
            basis_points(elliptical.gaussian_out_of_sample_cvar_gap),
            "bp, variance book minus CVaR book",
        )
    )
    write_line(
        _field(
            "out-of-sample CVaR gap, fat-tailed",
            basis_points(elliptical.fat_tailed_out_of_sample_cvar_gap),
            "bp, variance book minus CVaR book",
        )
    )
    _print_frontier_penalty(points)
    write_line()


def _print_frontier_penalty(points: tuple[FrontierPoint, ...]) -> None:
    """Print what the variance book costs on the CVaR axis, across the sweep."""
    penalties = _variance_penalty(points)
    if not penalties:
        write_line(_field("variance book on the CVaR axis", ABSENT))
        return
    target, worst = max(penalties, key=lambda pair: pair[1])
    write_line(
        _field(
            "worst extra CVaR of the variance book",
            basis_points(worst),
            f"bp, at a target of {basis_points(target)} bp",
        )
    )
    write_line(
        _field(
            "targets where both books solved",
            str(len(penalties)),
            "of the frontier grid",
        )
    )


def print_algorithms(ladder: tuple[LadderRow, ...]) -> None:
    """Print the scenario-count by algorithm table.

    The objectives are what the table is for: three genuinely different
    methods landing on the same tail average is the evidence that the
    reformulation has one answer rather than one per solver.
    """
    write_line("The same program under three algorithms")
    write_line(
        row(
            [
                "scenarios",
                "solver",
                "status",
                "objective bp",
                "seconds",
                "iterations",
            ],
            _LADDER_WIDTHS,
        )
    )
    write_line(rule(_LADDER_WIDTHS))
    for entry in ladder:
        write_line(
            row(
                [
                    str(entry.scenarios),
                    entry.solver_name,
                    entry.status,
                    ABSENT
                    if entry.objective is None
                    else basis_points(entry.objective),
                    seconds(entry.solve_seconds),
                    optional_count(entry.iterations),
                ],
                _LADDER_WIDTHS,
            )
        )
    write_line()


def print_frontier(points: tuple[FrontierPoint, ...]) -> None:
    """Print how much of the target grid the mandate can actually reach.

    An unreachable target is recorded with the solver's own status and no
    book, so the two counts below are a property of the mandate at this
    sample and not a count of failures.
    """
    solved = [point for point in points if point.cvar_outcome.solution is not None]
    unsolved = [point for point in points if point.cvar_outcome.solution is None]
    write_line("Frontier sweep")
    write_line(_field("targets swept", str(len(points))))
    write_line(_field("feasible", str(len(solved))))
    if unsolved:
        first = min(point.target_monthly for point in unsolved)
        statuses = sorted({point.cvar_outcome.status for point in unsolved})
        write_line(
            _field(
                "infeasible",
                str(len(unsolved)),
                f"first unreachable target {basis_points(first)} bp, "
                f"status {', '.join(statuses)}",
            )
        )
    else:
        write_line(_field("infeasible", "0", "every target on the grid is reachable"))
    if solved:
        lowest, highest = solved[0], solved[-1]
        write_line(
            _field(
                "CVaR at the lowest feasible target",
                _objective_bp(lowest),
                f"bp, target {basis_points(lowest.target_monthly)} bp",
            )
        )
        write_line(
            _field(
                "CVaR at the highest feasible target",
                _objective_bp(highest),
                f"bp, target {basis_points(highest.target_monthly)} bp",
            )
        )
    write_line()


def _objective_bp(point: FrontierPoint) -> str:
    """Write one frontier point's CVaR in basis points."""
    solution = point.cvar_outcome.solution
    return ABSENT if solution is None else basis_points(solution.objective)
