"""The frontier figure, and the canvas every figure in this lab is built on.

No `pyplot` anywhere in this lab. `pyplot` keeps a process-wide registry
of open figures and picks an interactive backend the first time it is
imported, which is exactly the machinery that turns a host-run `pytest`
into a window nobody asked for. A bare `Figure` has neither: it renders
through Agg the moment it is asked for a `.png`, it belongs to whoever
holds the reference, and closing it is releasing it.

Each builder returns a finished `Figure` and writes nothing. `plots.py`
owns the saving and the releasing, so the two concerns stay apart and a
builder can be exercised without a filesystem.

The frontier lives here and the two figures that describe one portfolio
live in `plots_book.py`, which is the same line `plots.py` draws when it
decides what a run can draw: a sweep is a property of the mandate and the
sample, so it exists even where the headline target was unreachable.

Every subtitle names the scenario count the figure was drawn at. A
frontier traced on 600 scenarios and one traced on 10,000 are different
pictures of the same mandate — the shape, the ceiling and which limits
bite all move with the sample — so a figure that did not say which it was
would be unreadable six months later.
"""

from __future__ import annotations

import numpy as np
from matplotlib.axes import Axes
from matplotlib.figure import Figure

from app.bundle import RunBundle
from app.console_format import BASIS_POINT
from app.contracts import FloatArray, FrontierPoint
from app.errors import ArtifactError
from app.plots_theme import (
    FIGURE_DPI,
    FIGURE_SIZE,
    HAIRLINE,
    LINE_WIDTH,
    MARKER_SIZE,
    MUTED,
    SERIES_ONE,
    SERIES_TWO,
    SURFACE,
    style_axes,
    style_legend,
)


def canvas() -> tuple[Figure, Axes]:
    """Return a new figure and its single set of axes."""
    figure = Figure(figsize=FIGURE_SIZE, dpi=FIGURE_DPI, facecolor=SURFACE)
    return figure, figure.add_subplot(111)


def in_basis_points(values: FloatArray) -> FloatArray:
    """Rescale a vector of fractions into basis points."""
    scaled: FloatArray = values / BASIS_POINT
    return scaled


def _feasible(points: tuple[FrontierPoint, ...]) -> list[FrontierPoint]:
    """Return the swept targets the mandate could actually reach."""
    return [point for point in points if point.cvar_outcome.solution is not None]


def build_frontier(bundle: RunBundle) -> Figure:
    """Draw both books' tail loss against the return the desk demands.

    One vertical axis, deliberately: both curves are a 95% CVaR measured
    on the same empirical tail of the same matrix, so they belong on the
    same ruler. Putting the variance book's own objective on a second axis
    would let two unrelated scales look like they cross.

    Raises:
        ArtifactError: If no swept target produced a book, so there is no
            frontier to draw.
    """
    solved = _feasible(bundle.frontier)
    if not solved:
        raise ArtifactError(
            "no frontier point produced a book, so there is no frontier to plot"
        )
    figure, axes = canvas()
    targets = np.array([point.target_monthly for point in solved]) / BASIS_POINT
    chosen = np.array(
        [
            point.cvar_outcome.solution.objective
            for point in solved
            if point.cvar_outcome.solution is not None
        ]
    )
    axes.plot(
        targets,
        chosen / BASIS_POINT,
        color=SERIES_ONE,
        linewidth=LINE_WIDTH,
        marker="o",
        markersize=MARKER_SIZE,
        label="CVaR book",
        zorder=3,
    )
    _plot_variance_arm(axes, solved)
    _mark_ceiling(axes, bundle.frontier)
    style_axes(
        axes,
        title="What the desk pays in tail risk for the return it demands",
        subtitle=(
            f"{bundle.market.mode} market, "
            f"{int(bundle.market.returns.shape[0])} scenarios, "
            f"{len(bundle.frontier)} targets swept"
        ),
        xlabel="required net monthly return (bp of NAV)",
        ylabel="95% CVaR (bp of NAV per month)",
    )
    style_legend(axes, location="upper left")
    figure.tight_layout()
    return figure


def _plot_variance_arm(axes: Axes, solved: list[FrontierPoint]) -> None:
    """Score the mean-variance book on the CVaR axis, where it is comparable."""
    scored = [
        (point.target_monthly, point.cvar_of_variance_portfolio)
        for point in solved
        if point.cvar_of_variance_portfolio is not None
    ]
    if not scored:
        return
    axes.plot(
        np.array([target for target, _ in scored]) / BASIS_POINT,
        np.array([value for _, value in scored]) / BASIS_POINT,
        color=SERIES_TWO,
        linewidth=LINE_WIDTH,
        marker="s",
        markersize=MARKER_SIZE,
        label="mean-variance book, scored on CVaR",
        zorder=2,
    )


def _mark_ceiling(axes: Axes, points: tuple[FrontierPoint, ...]) -> None:
    """Draw the line past which the mandate cannot deliver the return."""
    unreachable = [
        point.target_monthly for point in points if point.cvar_outcome.solution is None
    ]
    if not unreachable:
        return
    first = min(unreachable) / BASIS_POINT
    axes.axvline(first, color=MUTED, linewidth=HAIRLINE, linestyle="--", zorder=1)
    axes.annotate(
        "mandate cannot reach\nthis return at any risk",
        xy=(first, axes.get_ylim()[0]),
        xytext=(-6, 8),
        textcoords="offset points",
        fontsize=8,
        color=MUTED,
        ha="right",
    )
