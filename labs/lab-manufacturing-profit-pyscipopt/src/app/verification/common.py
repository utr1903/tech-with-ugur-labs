"""Numerical comparisons and immutable verification results."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.contracts import FloatArray, SolverSettings


@dataclass(frozen=True)
class Violation:
    code: str
    field: str
    residual: float
    tolerance: float


@dataclass(frozen=True)
class CashBreakdown:
    revenue: FloatArray
    salaries: FloatArray
    materials: FloatArray
    electricity: FloatArray
    office_overhead: FloatArray
    factory_overhead: FloatArray
    shipping: FloatArray
    investment: FloatArray
    net_cash: FloatArray


@dataclass(frozen=True)
class VerificationReport:
    ok: bool
    violations: tuple[Violation, ...]
    cash: CashBreakdown
    regional_cost: FloatArray


class Checks:
    """Collect every scalar violation, retaining array coordinates."""

    def __init__(self, settings: SolverSettings) -> None:
        self.settings = settings
        self.violations: list[Violation] = []

    def compare(
        self,
        code: str,
        left: FloatArray | float,
        right: FloatArray | float,
        *,
        equality: bool = False,
    ) -> None:
        a, b = np.broadcast_arrays(np.asarray(left), np.asarray(right))
        tolerance = (
            self.settings.feasibility_abs
            + self.settings.feasibility_rel * np.maximum(np.abs(a), np.abs(b))
        )
        residual = np.abs(a - b) if equality else a - b
        for index in np.ndindex(a.shape):
            if residual[index] > tolerance[index]:
                self.violations.append(
                    Violation(
                        code,
                        f"{code}{index}",
                        float(residual[index]),
                        float(tolerance[index]),
                    )
                )

    def integer(self, field: str, values: FloatArray) -> None:
        for index in np.ndindex(values.shape):
            residual = float(abs(values[index] - np.rint(values[index])))
            if residual > self.settings.integrality_abs:
                self.violations.append(
                    Violation(
                        "integrality",
                        f"{field}{index}",
                        residual,
                        self.settings.integrality_abs,
                    )
                )


def availability(starts: FloatArray) -> FloatArray:
    result = np.zeros_like(starts)
    result[:, 1:] = np.cumsum(starts[:, :-1], axis=1)
    return result
