"""Runs every scenario under each policy profile and writes the coverage matrix."""

from __future__ import annotations

import time
from collections.abc import Sequence
from pathlib import Path

from app.bench.aggregate import evaluate, summarize
from app.bench.attribute import attribute
from app.bench.marker import parse_marker
from app.bench.model import Profile, RunResult
from app.bench.render import render_json, render_markdown
from app.errors import ExpectationError
from app.kube.events import EventStream
from app.kube.kubectl import exec_script
from app.kube.policy_apply import apply_profile, delete_lab_policies
from app.kube.tetra import override_available
from app.logging_setup import Logger
from app.output import write_line
from app.scenarios.load import load_scenarios
from app.scenarios.model import Scenario

FLUSH_MARGIN_S = 1.0
LAB_ROOT = Path(__file__).resolve().parents[4]


def select(scenarios: Sequence[Scenario], only: Sequence[str]) -> tuple[Scenario, ...]:
    """Scenarios whose id starts with any prefix in `only` (all when empty)."""
    return tuple(
        s for s in scenarios if not only or any(s.id.startswith(p) for p in only)
    )


def _run_once(
    scenario: Scenario,
    profile: Profile,
    index: int,
    *,
    stream: EventStream,
    window_s: float,
    log: Logger,
) -> RunResult:
    ns, pod, base = scenario.namespace, scenario.pod, scenario.directory
    exec_script(ns, pod, base / "cleanup.sh", log=log)
    acted = exec_script(ns, pod, base / "run.sh", log=log)
    marker = parse_marker(acted.stdout)
    time.sleep(window_s + FLUSH_MARGIN_S)
    side_effect = exec_script(ns, pod, base / "check.sh", log=log).returncode == 0
    attribution = attribute(
        stream.snapshot(), scenario, marker=marker, window_s=window_s
    )
    return RunResult(
        scenario_id=scenario.id,
        profile=profile,
        run_index=index,
        detected=attribution.detected,
        latency_ms=attribution.latency_ms,
        enforcement_seen=attribution.enforcement_seen,
        side_effect=side_effect,
    )


def _run_profile(
    profile: Profile,
    scenarios: Sequence[Scenario],
    *,
    root: Path,
    runs: int,
    window_s: float,
    override: bool,
    log: Logger,
) -> list[RunResult]:
    apply_profile(profile, root / "policies", override=override, log=log)
    results: list[RunResult] = []
    with EventStream(log=log) as stream:
        for scenario in scenarios:
            for index in range(runs):
                results.append(
                    _run_once(
                        scenario,
                        profile,
                        index,
                        stream=stream,
                        window_s=window_s,
                        log=log,
                    )
                )
    return results


def _fail_on(failures: Sequence[str]) -> None:
    if failures:
        raise ExpectationError(f"{len(failures)} expectation(s) failed")


def run(
    *,
    root: Path,
    runs: int,
    window_s: float,
    profiles: Sequence[Profile],
    results_dir: Path,
    only: Sequence[str] = (),
    log: Logger,
) -> None:
    """Runs the benchmark, writes coverage.md/json, fails on unmet expectations."""
    try:
        log.info("Running bench...", runs=runs, window_s=window_s, profiles=profiles)
        scenarios = select(load_scenarios(root / "scenarios", log=log), only)
        override = override_available(log=log)
        results: list[RunResult] = []
        try:
            for profile in profiles:
                results += _run_profile(
                    profile,
                    scenarios,
                    root=root,
                    runs=runs,
                    window_s=window_s,
                    override=override,
                    log=log,
                )
        finally:
            delete_lab_policies(log=log)
        summaries = summarize(results, override_available=override, scenarios=scenarios)
        failures = evaluate(summaries, scenarios)
        results_dir.mkdir(parents=True, exist_ok=True)
        markdown = render_markdown(
            summaries, scenarios, override_available=override, failures=failures
        )
        (results_dir / "coverage.md").write_text(markdown)
        (results_dir / "coverage.json").write_text(
            render_json(
                summaries, scenarios, override_available=override, failures=failures
            )
        )
        write_line(markdown)
        _fail_on(failures)
    except Exception:
        log.exception("Running bench failed.", runs=runs, profiles=profiles)
        raise
    else:
        log.info(
            "Running bench succeeded.", scenarios=len(scenarios), results=len(results)
        )
