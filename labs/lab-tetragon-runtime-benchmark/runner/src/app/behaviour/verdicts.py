"""Judges and renders the behaviour demo results."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

LESSON_DEMO = "sigkill-vs-override"
LESSON = (
    "Sigkill kills rm, but the file is already gone: the kill does not stop the "
    "deletion. Override makes the unlink syscall itself fail, so the file "
    "survives."
)


@dataclass(frozen=True)
class DemoResult:
    """One demo case: did the policy alert as expected, and did the effect match."""

    name: str
    case: str
    expected_alert: bool
    alerted: bool
    detail: str
    outcome_ok: bool


def _failure(result: DemoResult) -> str | None:
    label = f"{result.name}/{result.case}"
    if result.expected_alert and not result.alerted:
        return f"{label}: missing alert ({result.detail})"
    if not result.expected_alert and result.alerted:
        return f"{label}: unexpected alert ({result.detail})"
    if not result.outcome_ok:
        return f"{label}: wrong outcome ({result.detail})"
    return None


def judge(results: Sequence[DemoResult]) -> tuple[str, ...]:
    """Every way a result differs from its expectation."""
    return tuple(f for f in (_failure(r) for r in results) if f is not None)


def _row(result: DemoResult) -> str:
    expected = "alert" if result.expected_alert else "no alert"
    seen = "alert" if result.alerted else "no alert"
    verdict = "ok" if _failure(result) is None else "FAIL"
    return (
        f"| {result.name} | {result.case} | {expected} | {seen} | "
        f"{verdict} | {result.detail} |"
    )


def render_behaviour(results: Sequence[DemoResult]) -> str:
    """Markdown summary of every case, with the Sigkill-versus-Override lesson."""
    lines = [
        "# Behaviour demos",
        "",
        "| Demo | Case | Expected | Seen | Verdict | Detail |",
        "|---|---|---|---|---|---|",
        *(_row(r) for r in results),
        "",
    ]
    if any(r.name == LESSON_DEMO for r in results):
        lines += [f"**Lesson:** {LESSON}", ""]
    failures = judge(results)
    if failures:
        lines += [f"FAILED: {len(failures)} case(s) did not match.", ""]
        lines += [f"- {f}" for f in failures]
    else:
        lines += ["All behaviour cases matched their expectation."]
    return "\n".join(lines) + "\n"
