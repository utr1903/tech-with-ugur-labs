"""Render the landscape and complete optimization histories without a display."""

from __future__ import annotations

from pathlib import Path

from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from app.experiment import Iteration, cost
from app.logging_setup import Logger


def write_plot(rows: tuple[Iteration, ...], destination: Path, *, log: Logger) -> None:
    """Save a two-panel PNG with all recorded states in both panels."""
    log.info("Writing plot...", destination=str(destination), rows=len(rows))
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        figure = Figure(figsize=(12, 5), layout="constrained")
        FigureCanvasAgg(figure)
        landscape = figure.add_subplot(1, 2, 1)
        history = figure.add_subplot(1, 2, 2)
        xs = [-2.8 + index * 5.6 / 1000 for index in range(1001)]
        landscape.plot(xs, [cost(x) for x in xs], color="#333333", label="f(x)")
        colors = ("#0072B2", "#D55E00", "#009E73")
        for index, name in enumerate(dict.fromkeys(row.run for row in rows)):
            states = [row for row in rows if row.run == name]
            color = colors[index % len(colors)]
            label = f"{name}: start {states[0].x:g}"
            landscape.plot(
                [row.x for row in states],
                [row.cost for row in states],
                ".-",
                color=color,
                markersize=4,
                linewidth=1,
                label=label,
            )
            history.plot(
                [row.iteration for row in states],
                [row.cost for row in states],
                ".-",
                color=color,
                markersize=3,
                linewidth=1,
                label=label,
            )
        landscape.set(
            title="Cost landscape and all iterates", xlabel="x", ylabel="f(x)"
        )
        history.set(title="Cost at every iteration", xlabel="Iteration", ylabel="f(x)")
        for axis in (landscape, history):
            axis.grid(alpha=0.25)
            axis.legend(fontsize=8)
        figure.savefig(destination, dpi=160)
    except Exception:
        log.exception(
            "Writing plot failed.", destination=str(destination), rows=len(rows)
        )
        raise
    else:
        log.info(
            "Writing plot succeeded.", destination=str(destination), rows=len(rows)
        )
