"""The two figures that describe one solved portfolio.

Both need a book, so both refuse a run whose headline target the mandate
could not reach rather than drawing an empty chart. `plots.py` skips them
in that case and says so in the log; the frontier in `plots_figures.py`
is still drawn, because a sweep is a property of the mandate rather than
of any one portfolio.

The exposure map is the one to read carefully. Its bars are the *book's*
own per-sector net and gross, while the dashed gross line is a cap the
model enforces on `Msec @ (l + s)`. Those two coincide only where the
signed split is exact, so a bar approaching that line is not the test of
whether the cap binds — `sectors.csv` carries the row the model actually
constrains, and the console's limit table decides activity on it.

This file runs a little past the ~200-line target the lab holds its
modules to: about 135 lines are executable, and most of the rest is the
derivation of the two axis-padding factors, which is written beside them
so the next person to move a legend can check the arithmetic instead of
guessing at a magic number.
"""

from __future__ import annotations

import numpy as np
from matplotlib.axes import Axes
from matplotlib.figure import Figure

from app.bundle import RunBundle
from app.console_format import BASIS_POINT
from app.contracts import FloatArray, VerificationReport
from app.errors import ArtifactError
from app.plots_figures import canvas, in_basis_points
from app.plots_theme import (
    FILL,
    HAIRLINE,
    LINE_WIDTH,
    MUTED,
    SERIES_ONE,
    SERIES_TWO,
    style_axes,
    style_legend,
)

# How far above the gross-cap line the top of the axis sits, as a multiple
# of that cap. The legend goes in the band this opens up, so the band has
# to be taller than the legend: two rows of 9-point text is about 25 pt,
# which at the figure's 150 dpi is 25 * 150 / 72 = 52 px against an axes
# height near 600 px, so the legend needs about 0.09 of the height. On the
# shipped mandate 1.32 opens a band of (1.32 - 1.00) * 0.35 = 0.112 of NAV
# above a 0.35 cap, which is 0.18 of the plotted range — twice what the
# legend occupies. Raising it wastes white space; lowering it past about
# 1.15 puts the legend on the cap line.
LEGEND_HEADROOM = 1.32

# The matching margin under the deepest downside line, as a multiple of
# it, so the lower sector-net cap is not drawn on the axis floor. On the
# shipped mandate 1.45 leaves 0.08 of the plotted range below that line,
# which is a clear gap at this figure size without doubling the empty
# space beneath the bars.
FLOOR_MARGIN = 1.45


def build_loss_distribution(bundle: RunBundle) -> Figure:
    """Draw the book's in-sample loss histogram with VaR and CVaR marked.

    The shaded span is the worst `(1 - beta)` share of the sample, which is
    the only part of this picture the model can see: VaR is where it starts
    and CVaR is its average, so CVaR is always the further right of the two.

    Raises:
        ArtifactError: If the headline produced no book.
    """
    solution = bundle.headline.solution
    report = bundle.verification
    if solution is None or report is None:
        raise ArtifactError(
            "the headline solve produced no book, so it has no loss distribution"
        )
    figure, axes = canvas()
    losses = in_basis_points(-(bundle.market.returns @ solution.weights))
    axes.hist(losses, bins=90, color=FILL, zorder=2)
    _mark_tail(axes, report, losses)
    style_axes(
        axes,
        title="Where the loss lives, and the slice the model minimizes",
        subtitle=(
            f"{bundle.market.mode} market, "
            f"{losses.size} in-sample scenarios, "
            f"worst {report.in_sample.tail_count} in the tail"
        ),
        xlabel="one-month loss (bp of NAV; negative is a gain)",
        ylabel="scenarios",
    )
    style_legend(axes, location="upper left")
    figure.tight_layout()
    return figure


def _mark_tail(axes: Axes, report: VerificationReport, losses: FloatArray) -> None:
    """Shade the tail and draw the two numbers taken from it."""
    var = report.in_sample.var / BASIS_POINT
    cvar = report.in_sample.cvar / BASIS_POINT
    axes.axvspan(
        var,
        float(losses.max()),
        color=SERIES_TWO,
        alpha=0.10,
        zorder=1,
        label="the tail the model averages",
    )
    axes.axvline(
        var,
        color=SERIES_ONE,
        linewidth=LINE_WIDTH,
        zorder=3,
        label=f"VaR {var:.0f} bp",
    )
    axes.axvline(
        cvar,
        color=SERIES_TWO,
        linewidth=LINE_WIDTH,
        zorder=3,
        label=f"CVaR {cvar:.0f} bp",
    )


def build_exposures(bundle: RunBundle) -> Figure:
    """Draw the book's net and gross exposure per sector against the caps.

    Both bars are the *book's* own quantities — `sum w` and `sum |w|` over
    the sector — and the dashed lines are the mandate's caps. The gross cap
    is enforced on `Msec @ (l + s)`, which bounds the gross bar from above
    rather than equalling it, so the bar reaching the line is not the test
    of whether that cap binds; `sectors.csv` carries the row the model
    actually constrains, and the console's limit table decides activity on
    it.

    Raises:
        ArtifactError: If the headline produced no book.
    """
    report = bundle.verification
    if report is None:
        raise ArtifactError(
            "the headline solve produced no book, so it has no exposures"
        )
    figure, axes = canvas()
    universe, limits = bundle.scenario.universe, bundle.scenario.limits
    positions = np.arange(len(universe.sectors))
    width = 0.38
    axes.bar(
        positions - width / 2,
        in_basis_points(report.sector_net),
        width,
        color=SERIES_ONE,
        label="sector net, sum w",
        zorder=3,
    )
    axes.bar(
        positions + width / 2,
        in_basis_points(report.sector_gross),
        width,
        color=SERIES_TWO,
        label="sector gross, sum |w|",
        zorder=3,
    )
    _mark_sector_caps(axes, limits.sector_net_cap, limits.sector_gross_cap)
    axes.set_ylim(
        bottom=min(float(report.sector_net.min()), -limits.sector_net_cap)
        / BASIS_POINT
        * FLOOR_MARGIN,
        top=limits.sector_gross_cap / BASIS_POINT * LEGEND_HEADROOM,
    )
    axes.set_xticks(positions)
    axes.set_xticklabels(universe.sectors, fontsize=9)
    style_axes(
        axes,
        title="Where the risk sits, sector by sector",
        subtitle=(
            f"the solved book at a "
            f"{bundle.scenario.headline_target_monthly / BASIS_POINT:.0f} bp "
            f"target, {int(bundle.market.returns.shape[0])} scenarios"
        ),
        xlabel="",
        ylabel="exposure (bp of NAV)",
    )
    style_legend(axes, location="upper left", columns=2)
    figure.tight_layout()
    return figure


def _mark_sector_caps(axes: Axes, net_cap: float, gross_cap: float) -> None:
    """Draw the three mandate lines the bars are measured against.

    The lines are named in the legend rather than annotated in place. A
    label written beside a full-width line has to sit somewhere over the
    plot, and wherever that is, some book will eventually put a bar there.
    """
    for level, text in (
        (gross_cap / BASIS_POINT, "sector gross cap, enforced on l + s"),
        (net_cap / BASIS_POINT, "sector net cap, either side"),
        (-net_cap / BASIS_POINT, None),
    ):
        axes.axhline(
            level,
            color=MUTED,
            linewidth=HAIRLINE,
            linestyle="--",
            zorder=1,
            label=text,
        )
