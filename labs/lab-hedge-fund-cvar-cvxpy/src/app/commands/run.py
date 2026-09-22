"""One complete run: every stage of the lab, in the one order that works.

This module holds no mathematics. It loads a scenario, applies the two
command-line overrides, draws both markets, solves the headline book,
checks it, runs the four measurements that surround it, and hands the
whole bundle to the three reader-facing writers.

**The order is not free, and two things fix it.**

`verify_solution` reads the extracted `PortfolioSolution`, which holds
copies of the solver's arrays. `build_dual_table` re-solves the caller's
*own* compiled problem at nudged right-hand sides and restores it
afterwards. So verification runs first, and nothing after the dual table
reads `built`'s variables expecting the headline's values to still be on
them. The frontier sweep and the ladder compile their own problems, so
they are unaffected either way.

The atom oracle is a second, independently built program over the same
constraints. It is solved before verification because `verify_solution`
takes its objective as an argument rather than building a CVXPY problem
of its own — that is what keeps the checking layer free of CVXPY.

**An unreachable headline target ends the run** with `InfeasibleError`
and writes nothing. The status the solver reported is logged verbatim
first, so the reason survives in the log even though no artifact does.
This is the headline only: the frontier sweep solves the same mandate at
twenty-five targets and records every `infeasible` among them verbatim,
which is where a reader sees an unreachable target without the run
having to fail.

**`returns_csv` — the top-level field, not one inside `market` — is not
read here.** The loader in `returns_csv.py`
turns a reader's own history into exactly the `MarketScenarios` this
orchestration passes around, but the run draws both matrices from the
seeded generator: the out-of-sample ruler has to be disjoint from the
in-sample matrix, and one history cannot supply both without a holdout
convention the lab does not define. The README says what the loader
needs and which line to change.

This file runs past the ~200-line target the lab holds its modules to, on
prose rather than code: about 136 of its 236 lines are executable and the
rest is the three rules above. It is deliberately one function's worth of
straight-line wiring — the order is the whole content, and splitting it
would put half the sequence in a file that cannot see the other half.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from app.algorithms import run_algorithm_ladder
from app.artifacts import write_artifacts
from app.bundle import RunBundle, file_digest, resolve_versions
from app.console import print_report
from app.contracts import MarketScenarios, Scenario, SolveOutcome
from app.duals import build_dual_table
from app.errors import InfeasibleError
from app.frontier import sweep_frontier
from app.logging_setup import Logger
from app.market import generate_scenarios
from app.model import BuiltProblem, build_atom_oracle_problem, build_cvar_problem
from app.plots import write_plots
from app.scenario import load_scenario
from app.solver import solve_problem
from app.studies import run_elliptical_study
from app.studies_optimism import run_optimism_study
from app.validation import validate_scenario
from app.verification import verify_solution

# The headline book, its oracle and every nudged re-solve behind the
# shadow prices run under one algorithm, so the reported book is one
# method's answer rather than a mixture. `algorithms.py` is where the
# other two appear, side by side on the same rungs.
HEADLINE_ALGORITHM = "CLARABEL"


def _overridden(scenario: Scenario, *, mode: str | None, seed: int | None) -> Scenario:
    """Apply the `--mode` and `--seed` overrides to the market block.

    Either override re-runs `validate_scenario`, because both can break a
    rule the file satisfied: an unknown mode, or a seed that collides with
    `market.out_of_sample_seed` and would draw the ruler as the in-sample
    matrix.
    """
    if mode is None and seed is None:
        return scenario
    overridden = replace(
        scenario,
        market=replace(
            scenario.market,
            mode=scenario.market.mode if mode is None else mode,
            seed=scenario.market.seed if seed is None else seed,
        ),
    )
    validate_scenario(overridden)
    return overridden


def _draw(scenario: Scenario, *, seed: int, count: int, log: Logger) -> MarketScenarios:
    """Draw one return matrix from the scenario's generator settings."""
    return generate_scenarios(
        scenario.universe,
        scenario.market,
        seed=seed,
        count=count,
        mode=scenario.market.mode,
        log=log,
    )


def _headline(scenario: Scenario, built: BuiltProblem, *, log: Logger) -> SolveOutcome:
    """Solve the reported book, and refuse a target the mandate cannot reach."""
    outcome = solve_problem(
        built,
        algorithm=HEADLINE_ALGORITHM,
        target=scenario.headline_target_monthly,
        log=log,
    )
    if outcome.solution is None:
        raise InfeasibleError(
            f"{outcome.solver_name} reported status {outcome.status!r} at the "
            f"headline target of {scenario.headline_target_monthly}: the desk "
            f"mandate cannot reach that expected net monthly return"
        )
    return outcome


def _oracle_cvar(scenario: Scenario, market: MarketScenarios, *, log: Logger) -> float:
    """Solve the independent `sum_largest` program and return its optimum."""
    outcome = solve_problem(
        build_atom_oracle_problem(scenario, market, log=log),
        algorithm=HEADLINE_ALGORITHM,
        target=scenario.headline_target_monthly,
        log=log,
    )
    if outcome.solution is None:
        raise InfeasibleError(
            f"the sum_largest oracle came back {outcome.status!r} where the "
            f"linear program found a book; the two programs are the same "
            f"choice over the same constraints and must agree on feasibility"
        )
    return outcome.solution.objective


def _bundle(
    scenario_path: Path, *, mode: str | None, seed: int | None, log: Logger
) -> RunBundle:
    """Run every stage once and gather the results into one frozen bundle."""
    scenario = _overridden(load_scenario(scenario_path, log=log), mode=mode, seed=seed)
    market = _draw(
        scenario, seed=scenario.market.seed, count=scenario.market.scenarios, log=log
    )
    out_of_sample = _draw(
        scenario,
        seed=scenario.market.out_of_sample_seed,
        count=scenario.market.out_of_sample_scenarios,
        log=log,
    )
    built = build_cvar_problem(scenario, market, log=log)
    headline = _headline(scenario, built, log=log)
    report = verify_solution(
        scenario,
        market,
        out_of_sample,
        headline,
        _oracle_cvar(scenario, market, log=log),
        target=scenario.headline_target_monthly,
        log=log,
    )
    return RunBundle(
        scenario=scenario,
        scenario_digest=file_digest(scenario_path),
        market=market,
        out_of_sample=out_of_sample,
        headline=headline,
        verification=report,
        frontier=sweep_frontier(scenario, market, log=log),
        ladder=run_algorithm_ladder(scenario, log=log),
        duals=build_dual_table(scenario, market, built, headline, log=log),
        elliptical=run_elliptical_study(scenario, log=log),
        optimism=run_optimism_study(scenario, log=log),
        versions=resolve_versions(),
    )


def run(
    scenario_path: Path,
    output_dir: Path,
    *,
    mode: str | None,
    seed: int | None,
    log: Logger,
) -> None:
    """Solve one scenario, check it, and publish the files, plots and report.

    Args:
        scenario_path: The YAML scenario to read.
        output_dir: Where the six result files and three plots are written.
            It is created if it does not exist.
        mode: `"fat_tailed"`, `"gaussian"`, or `None` to keep the file's.
        seed: The in-sample seed, or `None` to keep the file's.
        log: Logger for the operation boundary.

    Raises:
        ScenarioError: If the file, an override or a semantic rule is bad.
        MarketError: If the generator cannot produce a usable matrix.
        ModelError: If a program cannot be built for this scenario.
        SolveError: If a solver failed, or two algorithms disagreed.
        InfeasibleError: If the mandate cannot reach the headline target.
        VerificationError: If a recomputed figure disagrees with the solve.
        ArtifactError: If a result file or plot cannot be written.

    Side effects:
        Reads the scenario, emits structured JSON logs throughout, and
        writes the artifacts, then the plots, then the console report —
        in that order, and only once every check has passed.
    """
    run_log = log.bind(scenario=str(scenario_path), output=str(output_dir))
    try:
        run_log.info("Running the portfolio lab...", mode=mode, seed=seed)
        bundle = _bundle(scenario_path, mode=mode, seed=seed, log=log)
        write_artifacts(output_dir, bundle, log=log)
        write_plots(output_dir, bundle, log=log)
        print_report(bundle)
    except Exception:
        run_log.exception("Running the portfolio lab failed.", mode=mode, seed=seed)
        raise
    else:
        report = bundle.verification
        run_log.info(
            "Running the portfolio lab succeeded.",
            status=bundle.headline.status,
            cvar=None if report is None else report.empirical_cvar,
            checks=0 if report is None else len(report.checks),
        )
