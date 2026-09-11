"""Versioned JSON document and input provenance."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields

from app.contracts import Scenario, SolveResult
from app.verification import VerificationReport


@dataclass(frozen=True)
class RunSource:
    path: str
    sha256: str
    time_limit_seconds_override: float | None
    relative_gap_override: float | None


def classification(result: SolveResult) -> str:
    if not result.metadata.has_incumbent:
        return "no_incumbent"
    return "optimal" if result.metadata.status == "optimal" else "feasible_incumbent"


def solution_json(
    s: Scenario,
    result: SolveResult,
    verification: VerificationReport,
    source: RunSource | None,
) -> str:
    d = result.decisions
    assert d is not None
    decisions = {
        field.name: getattr(d, field.name).tolist() for field in fields(d)[:-1]
    }
    decisions["cash_auxiliary"] = d.cash_auxiliary
    payload = {
        "schema_version": 1,
        "source": asdict(source) if source else None,
        "metadata": asdict(result.metadata),
        "classification": classification(result),
        "axes": asdict(s.axes),
        "decisions": decisions,
        "solver_settings": asdict(s.solver),
        "verification": {
            "ok": verification.ok,
            "violations": [asdict(v) for v in verification.violations],
            "tolerances": {
                "absolute": s.solver.feasibility_abs,
                "relative": s.solver.feasibility_rel,
                "integrality": s.solver.integrality_abs,
            },
        },
        "annual_cash_musd": {
            field.name: getattr(verification.cash, field.name).tolist()
            for field in fields(verification.cash)
        },
        "regional_cost_musd": verification.regional_cost.tolist(),
        "cumulative_cash_musd": float(verification.cash.net_cash.sum()),
        "units": {
            "money": "MUSD",
            "volume": "annual pump-volume units",
            "price": "MUSD per volume unit",
        },
    }
    return json.dumps(payload, indent=2, allow_nan=False) + "\n"
