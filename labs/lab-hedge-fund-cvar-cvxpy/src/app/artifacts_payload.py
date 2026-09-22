"""`solution.json`: the whole run, raw, in one machine-readable document.

The CSVs beside it are for reading in a spreadsheet. This file is for
reproducing: it carries what was asked, what answered, and what the
answer was checked against, with every float written at full precision.

**Provenance first.** A number is only reproducible if the inputs and the
build that produced it are recorded with it. So the document opens with
the sha256 of the `scenario.yaml` bytes, the digest, mode, seed and size
of both return matrices, the installed version of every library in the
path from model to answer, and the solver list CVXPY could actually
reach — which is not the same as the list this lab knows how to name.

**The status is verbatim and the weights may be absent.** An infeasible
headline records its status and a null weight vector rather than an empty
one, so nothing downstream can mistake "no book" for "the zero book".

**Read the `verification` block as portfolio quantities, not as
constraint rows.** Its field names are the frozen `VerificationReport`
contract and several of them — `gross_leverage`, `name_gross_max`,
`sector_gross`, `turnover` — match the label of a limit the model writes
on `l + s` or on `t` rather than on `w`. Every number under
`verification` is rebuilt from the weight vector alone, so it is the
book's own quantity and bounds the constraint's left-hand side from
below; it is not that left-hand side. The rows the model actually
constrains are in `duals[]`, each carrying its own `written_on`, and in
`weights.csv` (`name_gross_used`) and `sectors.csv`
(`model_gross_row`). The names are the contract and are not renamed here;
this paragraph is the annotation.

This file runs past the ~200-line target the lab holds its modules to,
and deliberately: it is one flat mapping from result types to JSON, with
no branching to follow, and every function is a dictionary literal.
Splitting it would scatter one document's shape across several imports
and make the payload harder, not easier, to read top to bottom.
"""

from __future__ import annotations

from typing import Any

from app.bundle import RunBundle
from app.contracts import (
    DualRow,
    FloatArray,
    FrontierPoint,
    LadderRow,
    MarketScenarios,
    PortfolioSolution,
    Scenario,
    SolveOutcome,
    TailStatistics,
    VerificationReport,
)
from app.cvxpy_api import installed_solvers
from app.lib.dual_verdicts import check_verdict
from app.limits import written_on
from app.studies import EllipticalResult
from app.studies_optimism import OptimismResult

Document = dict[str, Any]


def _floats(values: FloatArray) -> list[float]:
    """Write one array out as raw Python floats."""
    return [float(value) for value in values]


def _market(market: MarketScenarios) -> Document:
    """Record one return matrix's provenance, never the matrix itself."""
    return {
        "mode": market.mode,
        "seed": market.seed,
        "scenarios": int(market.returns.shape[0]),
        "names": int(market.returns.shape[1]),
        "digest": market.digest,
    }


def _solution(solution: PortfolioSolution) -> Document:
    """Record the raw variables the solver returned, legs included."""
    return {
        "weights": _floats(solution.weights),
        "long_leg": _floats(solution.long_leg),
        "short_leg": _floats(solution.short_leg),
        "turnover_leg": _floats(solution.turnover_leg),
        "var_auxiliary": solution.var_auxiliary,
        "objective": solution.objective,
    }


def _outcome(outcome: SolveOutcome) -> Document:
    """Record one solve: status verbatim, and its solution only if it has one."""
    return {
        "status": outcome.status,
        "solver_name": outcome.solver_name,
        "solve_seconds": outcome.solve_seconds,
        "iterations": outcome.iterations,
        "duals": dict(outcome.duals),
        "solution": None if outcome.solution is None else _solution(outcome.solution),
    }


def _tail(statistics: TailStatistics) -> Document:
    """Record one empirical tail."""
    return {
        "var": statistics.var,
        "cvar": statistics.cvar,
        "tail_count": statistics.tail_count,
    }


def _verification(report: VerificationReport) -> Document:
    """Record every independently recomputed number and every check."""
    return {
        "gross_leverage": report.gross_leverage,
        "net_exposure": report.net_exposure,
        "portfolio_beta": report.portfolio_beta,
        "turnover": report.turnover,
        "name_gross_max": report.name_gross_max,
        "sector_net": _floats(report.sector_net),
        "sector_gross": _floats(report.sector_gross),
        "expected_gross_return": report.expected_gross_return,
        "borrow_cost": report.borrow_cost,
        "trading_cost": report.trading_cost,
        "expected_net_return": report.expected_net_return,
        "in_sample": _tail(report.in_sample),
        "out_of_sample": _tail(report.out_of_sample),
        "model_objective": report.model_objective,
        "atom_oracle_cvar": report.atom_oracle_cvar,
        "empirical_cvar": report.empirical_cvar,
        "var_recovery_gap": report.var_recovery_gap,
        "threshold_count": report.threshold_count,
        "relaxation_max_overlap": report.relaxation_max_overlap,
        "checks": [{"name": name, "passed": passed} for name, passed in report.checks],
    }


def _frontier_point(point: FrontierPoint) -> Document:
    """Record one swept target and both books' verdicts on it."""
    return {
        "target_monthly": point.target_monthly,
        "cvar": _outcome(point.cvar_outcome),
        "variance": _outcome(point.variance_outcome),
        "cvar_of_variance_portfolio": point.cvar_of_variance_portfolio,
    }


def _ladder_row(entry: LadderRow) -> Document:
    """Record one rung of the algorithm ladder."""
    return {
        "scenarios": entry.scenarios,
        "solver_name": entry.solver_name,
        "status": entry.status,
        "objective": entry.objective,
        "solve_seconds": entry.solve_seconds,
        "iterations": entry.iterations,
    }


def _dual_row(entry: DualRow) -> Document:
    """Record one shadow price, what it prices, and how its check went.

    `agrees` is the contract's own field and `check` says which of its
    three false meanings applies. Both are written, and `duals.csv`
    carries the same pair, so the two artifacts of one run can never
    disagree about what was recorded.
    """
    return {
        "label": entry.label,
        "written_on": written_on(entry.label),
        "active": entry.active,
        "dual_value": entry.dual_value,
        "finite_difference": entry.finite_difference,
        "agrees": entry.agrees,
        "check": check_verdict(entry),
    }


def _elliptical(result: EllipticalResult) -> Document:
    """Record the two-mode comparison and the ratio the study formed."""
    return {
        "gaussian_weight_distance": result.gaussian_weight_distance,
        "fat_tailed_weight_distance": result.fat_tailed_weight_distance,
        "divergence_ratio": result.divergence_ratio,
        "gaussian_out_of_sample_cvar_gap": result.gaussian_out_of_sample_cvar_gap,
        "fat_tailed_out_of_sample_cvar_gap": result.fat_tailed_out_of_sample_cvar_gap,
        "seeds": result.seeds,
    }


def _optimism(result: OptimismResult) -> Document:
    """Record the in-sample optimism ladder."""
    return {
        "seeds": result.seeds,
        "rows": [
            {
                "scenarios": entry.scenarios,
                "in_sample_cvar": entry.in_sample_cvar,
                "out_of_sample_cvar": entry.out_of_sample_cvar,
                "gap": entry.gap,
            }
            for entry in result.rows
        ],
    }


def _tolerances(scenario: Scenario) -> Document:
    """Record the slack every check was allowed."""
    tolerances = scenario.tolerances
    return {
        "constraint_abs": tolerances.constraint_abs,
        "cvar_agreement_abs": tolerances.cvar_agreement_abs,
        "var_recovery_abs": tolerances.var_recovery_abs,
        "solver_agreement_rel": tolerances.solver_agreement_rel,
        "relaxation_abs": tolerances.relaxation_abs,
        "dual_relative": tolerances.dual_relative,
    }


def solution_payload(bundle: RunBundle) -> Document:
    """Assemble the whole run as one JSON-serializable document.

    Args:
        bundle: One complete run.

    Returns:
        A dictionary of plain Python values only — no NumPy arrays, no
        dataclasses — so `json.dumps` needs no custom encoder and nothing
        silently stringifies.
    """
    scenario = bundle.scenario
    report = bundle.verification
    return {
        "scenario_digest": bundle.scenario_digest,
        "cvar_beta": scenario.cvar_beta,
        "headline_target_monthly": scenario.headline_target_monthly,
        "universe": {
            "names": list(scenario.universe.names),
            "sectors": list(scenario.universe.sectors),
        },
        "market": _market(bundle.market),
        "out_of_sample": _market(bundle.out_of_sample),
        "versions": dict(bundle.versions),
        "installed_solvers": list(installed_solvers()),
        "status": bundle.headline.status,
        "headline": _outcome(bundle.headline),
        "verification": None if report is None else _verification(report),
        "frontier": [_frontier_point(point) for point in bundle.frontier],
        "algorithms": [_ladder_row(entry) for entry in bundle.ladder],
        "duals": [_dual_row(entry) for entry in bundle.duals],
        "elliptical_study": _elliptical(bundle.elliptical),
        "optimism_study": _optimism(bundle.optimism),
        "tolerances": _tolerances(scenario),
    }
