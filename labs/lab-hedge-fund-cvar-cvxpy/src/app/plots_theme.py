"""One look for all three figures: colours, sizes and the axis furniture.

The two series colours are a validated categorical pair — blue then
orange, assigned in a fixed order so the same idea keeps the same colour
across figures. They clear colour-vision-deficiency separation against each
other and 3:1 contrast against the surface, which is why the pair is fixed
here rather than chosen per chart. The single-series histogram uses a light
step of the same blue, since a lone distribution encodes magnitude rather
than identity.

Everything else is deliberately recessive: hairline gridlines on one axis
only, no box around the plot, axis labels in a muted ink. The data is the
only thing on the page with any weight.

These are static PNGs written into `output/`, so there is no hover layer
and no dark variant: a reader gets the same file whatever their terminal
looks like, and every figure carries a legend and axis labels so nothing
is encoded by colour alone.
"""

from __future__ import annotations

from typing import Literal

from matplotlib.axes import Axes

# The corners a legend is allowed to sit in. Spelled as a literal type
# because Matplotlib's own stubs accept only its named positions, so a
# bare `str` here would hide a typo until the figure was rendered.
type LegendLocation = Literal["best", "upper left", "lower left"]

# Categorical slots, in fixed assignment order.
SERIES_ONE = "#2a78d6"
SERIES_TWO = "#eb6834"

# A light step of the same blue, for a single series that encodes
# magnitude rather than identity.
FILL = "#b7d3f6"

# Chart chrome.
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
MUTED = "#898781"
GRIDLINE = "#e1e0d9"
BASELINE = "#c3c2b7"

# 150 dpi over a 9x5 inch canvas: large enough to read a sector label on a
# phone and small enough to commit.
FIGURE_SIZE = (9.0, 5.0)
FIGURE_DPI = 150

# Mark sizes, in typographic points. At 150 dpi a point is 150 / 72 =
# 2.08 px, so the 2.0-point series line lands at 4.2 px in the file and
# the 4.5-point marker at 9.4 px — thin marks and markers comfortably
# clear of the 8 px a reader needs to aim at one.
LINE_WIDTH = 2.0
MARKER_SIZE = 4.5
HAIRLINE = 1.0


def style_axes(
    axes: Axes, *, title: str, subtitle: str, xlabel: str, ylabel: str
) -> None:
    """Apply the shared chrome to one set of axes.

    Args:
        axes: The Matplotlib axes to dress.
        title: The question the figure answers.
        subtitle: What was measured, and at how many scenarios. Every
            figure carries its sample size, because a frontier at 600
            scenarios and one at 10,000 are different pictures.
        xlabel: The horizontal axis, with its unit.
        ylabel: The vertical axis, with its unit.
    """
    axes.set_title(f"{title}\n{subtitle}", fontsize=11, color=INK, loc="left")
    axes.set_xlabel(xlabel, fontsize=9, color=MUTED)
    axes.set_ylabel(ylabel, fontsize=9, color=MUTED)
    axes.set_facecolor(SURFACE)
    axes.grid(axis="y", color=GRIDLINE, linewidth=HAIRLINE, zorder=0)
    axes.set_axisbelow(True)
    for side in ("top", "right"):
        axes.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        axes.spines[side].set_color(BASELINE)
    axes.tick_params(colors=MUTED, labelsize=9)


def style_legend(
    axes: Axes, *, location: LegendLocation = "best", columns: int = 1
) -> None:
    """Put a legend on the axes, in the same recessive ink as the labels.

    `columns` exists for the one figure with four entries: laid out in a
    single column it is tall enough to reach down into the plot, and a
    legend sitting on a mark is worse than one spread sideways.
    """
    legend = axes.legend(loc=location, frameon=False, fontsize=9, ncols=columns)
    for text in legend.get_texts():
        text.set_color(INK)
