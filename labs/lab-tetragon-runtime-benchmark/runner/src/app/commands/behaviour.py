"""Runs the behaviour demos: lineage, stateful sequence, Sigkill vs Override."""

from __future__ import annotations

import time
from collections.abc import Sequence
from datetime import timedelta
from pathlib import Path

from app.behaviour.cases import CASES, Case, delete_outcome, is_alert, ran_as_intended
from app.behaviour.verdicts import DemoResult, judge, render_behaviour
from app.bench.marker import parse_marker
from app.errors import ExpectationError
from app.kube.events import EventStream
from app.kube.kubectl import exec_script
from app.kube.policy_apply import (
    apply_behaviour_policy,
    delete_behaviour_policies,
    delete_lab_policies,
)
from app.logging_setup import Logger
from app.output import write_line

FLUSH_MARGIN_S = 1.0
LESSON_DEMO = "sigkill-vs-override"


def _observe(
    case: Case,
    stream: EventStream,
    stdout: str,
    returncode: int,
    *,
    window_s: float,
) -> DemoResult:
    marker = parse_marker(stdout)
    time.sleep(window_s + FLUSH_MARGIN_S)
    end = marker + timedelta(seconds=window_s)
    seen = [
        e
        for e in stream.snapshot()
        if e.policy == case.policy
        and e.pod == case.watch_pod
        and marker <= e.time <= end
    ]
    alerted = any(is_alert(e, case) for e in seen)
    functions = sorted({(e.function or "?") for e in seen})
    detail = "policy events: " + (", ".join(functions) if functions else "none")
    outcome_ok, problem = ran_as_intended(case, stdout, returncode, set(functions))
    if problem:
        detail = f"{problem}; {detail}"
    if case.name == LESSON_DEMO:
        deleted_ok, outcome = delete_outcome(case.case, stdout)
        outcome_ok = outcome_ok and deleted_ok
        detail = f"{outcome}; {detail}"
    return DemoResult(
        case.name, case.case, case.expected_alert, alerted, detail, outcome_ok
    )


def _run_case(
    case: Case, stream: EventStream, *, root: Path, window_s: float, log: Logger
) -> DemoResult:
    try:
        log.info("Running behaviour case...", demo=case.name, case=case.case)
        apply_behaviour_policy(
            root / "behaviour" / case.policy_file, mode=case.mode, log=log
        )
        try:
            acted = exec_script(
                case.script_namespace,
                case.script_pod,
                root / "behaviour" / case.script,
                log=log,
            )
            result = _observe(
                case, stream, acted.stdout, acted.returncode, window_s=window_s
            )
        finally:
            delete_behaviour_policies(log=log)
    except Exception:
        log.exception("Running behaviour case failed.", demo=case.name, case=case.case)
        raise
    else:
        log.info(
            "Running behaviour case succeeded.",
            demo=case.name,
            case=case.case,
            alerted=result.alerted,
        )
        return result


def _fail_on(failures: Sequence[str]) -> None:
    if failures:
        raise ExpectationError(f"{len(failures)} behaviour case(s) failed")


def run(*, root: Path, window_s: float, results_dir: Path, log: Logger) -> None:
    """Runs every demo case, writes behaviour.md, fails on a mismatch."""
    try:
        log.info("Running behaviour demos...", cases=len(CASES))
        delete_lab_policies(log=log)
        results: list[DemoResult] = []
        try:
            with EventStream(log=log) as stream:
                for case in CASES:
                    results.append(
                        _run_case(case, stream, root=root, window_s=window_s, log=log)
                    )
        finally:
            delete_behaviour_policies(log=log)
        results_dir.mkdir(parents=True, exist_ok=True)
        markdown = render_behaviour(results)
        (results_dir / "behaviour.md").write_text(markdown)
        write_line(markdown)
        _fail_on(judge(results))
    except Exception:
        log.exception("Running behaviour demos failed.")
        raise
    else:
        log.info("Running behaviour demos succeeded.", cases=len(results))
