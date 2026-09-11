"""Static report figures, rendered without a display server."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from app.contracts import DecisionValues, Scenario
from app.logging_setup import Logger
from app.verification import VerificationReport


def write_plots(
    directory: Path,
    s: Scenario,
    d: DecisionValues,
    v: VerificationReport,
    *,
    log: Logger,
) -> tuple[Path, ...]:
    log.info("Rendering plots...", directory=str(directory))
    try:
        cash = _cash_plot(directory, s, v)
        investment = _investment_plot(directory, s, d)
    except Exception:
        log.exception("Rendering plots failed.", directory=str(directory))
        raise
    else:
        log.info("Rendering plots succeeded.", files=2)
        return cash, investment


def _cash_plot(directory: Path, s: Scenario, v: VerificationReport) -> Path:
    fig = Figure(figsize=(10, 6), layout="constrained")
    FigureCanvasAgg(fig)
    try:
        ax = fig.subplots()
        years = np.asarray(s.axes.years)
        ax.bar(years, v.cash.revenue, label="Revenue", color="#287d5b")
        bottom = np.zeros(3)
        for name in (
            "salaries",
            "materials",
            "electricity",
            "office_overhead",
            "factory_overhead",
            "shipping",
            "investment",
        ):
            values = -getattr(v.cash, name)
            ax.bar(years, values, bottom=bottom, label=name.replace("_", " ").title())
            bottom += values
        ax.plot(years, v.cash.net_cash, "ko-", label="Net cash")
        ax.axhline(0, color="black", linewidth=0.7)
        ax.set(
            title="Annual cash: exact physical costs",
            xlabel="Planning year",
            ylabel="Millions of USD",
            xticks=years,
        )
        ax.legend(loc="upper left", bbox_to_anchor=(1, 1), fontsize=8)
        path = directory / "cash_composition.png"
        fig.savefig(path, dpi=150)
    finally:
        fig.clear()
    return path


def _investment_plot(directory: Path, s: Scenario, d: DecisionValues) -> Path:
    fig = Figure(figsize=(10, 7), layout="constrained")
    FigureCanvasAgg(fig)
    try:
        top = fig.add_subplot(2, 1, 1)
        bottom = fig.add_subplot(2, 1, 2)
        years = np.asarray(s.axes.years)
        for i in range(len(s.axes.investments)):
            for t, year in enumerate(s.axes.years):
                if d.investment_start[i, t] > 0.5:
                    top.scatter(year, i, marker="D", s=80, color="#355f9f")
                    top.plot([year, year + 1], [i, i], color="#355f9f", linestyle=":")
                    top.scatter(year + 1, i, marker="o", s=35, color="#287d5b")
        top.set(
            yticks=range(4),
            yticklabels=[n.replace("_", " ") for n in s.axes.investments],
            xticks=years,
            xlim=(0.7, 3.3),
            ylim=(-0.6, 3.6),
            title="Investments: diamond = start; circle = available next year",
        )
        for f, factory in enumerate(s.axes.factories):
            for p, product in enumerate(s.axes.products):
                offset = (f * 2 + p - 1.5) * 0.2
                bottom.bar(
                    years + offset,
                    d.production[f, p],
                    width=0.18,
                    label=f"{factory}: {product.replace('_', ' ')}",
                )
        bottom.set(
            xticks=years,
            xlabel="Planning year",
            ylabel="Annual pump-volume units",
            title="Production by factory and product",
        )
        bottom.legend(fontsize=8, loc="upper left", bbox_to_anchor=(1, 1))
        path = directory / "investment_production.png"
        fig.savefig(path, dpi=150)
    finally:
        fig.clear()
    return path
