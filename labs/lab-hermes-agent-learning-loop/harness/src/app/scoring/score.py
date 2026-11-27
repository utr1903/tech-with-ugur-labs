"""Scores a triage report against the answer key."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.errors import ReportError
from app.logging_setup import Logger
from app.report_schema.models import TriageReport, load_report

type Finding = tuple[str, ...]

CATEGORIES = ("ip", "config", "dep")


@dataclass(frozen=True)
class CategoryScore:
    """Precision, recall and F1 for one finding category."""

    precision: float
    recall: float
    f1: float
    truth: int
    found: int
    correct: int


@dataclass(frozen=True)
class Score:
    """Overall and per-category score for one report."""

    precision: float
    recall: float
    f1: float
    by_category: dict[str, CategoryScore]
    missed: tuple[Finding, ...]
    extra: tuple[Finding, ...]
    format_failure: bool

    def to_dict(self) -> dict[str, object]:
        """A JSON-serialisable form; findings become lists."""
        return {
            "precision": self.precision,
            "recall": self.recall,
            "f1": self.f1,
            "by_category": {
                name: {
                    "precision": cat.precision,
                    "recall": cat.recall,
                    "f1": cat.f1,
                    "truth": cat.truth,
                    "found": cat.found,
                    "correct": cat.correct,
                }
                for name, cat in self.by_category.items()
            },
            "missed": [list(finding) for finding in self.missed],
            "extra": [list(finding) for finding in self.extra],
            "format_failure": self.format_failure,
        }


def flatten(report: TriageReport) -> frozenset[Finding]:
    """Reduces a report to a set of normalised findings.

    Service, flag and package names are lower-cased and stripped, IPs are
    stripped, advisory ids are upper-cased. The version is not part of the
    finding, and duplicates collapse.
    """
    findings: set[Finding] = set()
    for entry in report.services:
        service = entry.service.strip().lower()
        findings.update(("ip", service, ip.strip()) for ip in entry.suspicious_ips)
        findings.update(
            ("config", service, flag.strip().lower()) for flag in entry.risky_config
        )
        findings.update(
            (
                "dep",
                service,
                dep.package.strip().lower(),
                dep.advisory_id.strip().upper(),
            )
            for dep in entry.vulnerable_dependencies
        )
    return frozenset(findings)


def _ratio(numerator: int, denominator: int, *, empty: float) -> float:
    return numerator / denominator if denominator else empty


def _category_score(
    truth: frozenset[Finding], found: frozenset[Finding]
) -> CategoryScore:
    """Precision/recall/F1 for one category.

    Convention: nothing found and nothing expected scores 1.0 everywhere;
    nothing found but something expected has precision 0.0 and recall 0.0
    (so F1 is 0.0); something found but nothing expected has recall 1.0
    and precision 0.0.
    """
    correct = len(truth & found)
    if not truth and not found:
        return CategoryScore(1.0, 1.0, 1.0, 0, 0, 0)
    precision = _ratio(correct, len(found), empty=0.0)
    recall = _ratio(correct, len(truth), empty=1.0)
    f1 = _ratio(2 * correct, len(found) + len(truth), empty=0.0)
    return CategoryScore(precision, recall, f1, len(truth), len(found), correct)


def _compare(truth: frozenset[Finding], found: frozenset[Finding]) -> Score:
    overall = _category_score(truth, found)
    by_category = {
        name: _category_score(
            frozenset(f for f in truth if f[0] == name),
            frozenset(f for f in found if f[0] == name),
        )
        for name in CATEGORIES
    }
    return Score(
        precision=overall.precision,
        recall=overall.recall,
        f1=overall.f1,
        by_category=by_category,
        missed=tuple(sorted(truth - found)),
        extra=tuple(sorted(found - truth)),
        format_failure=False,
    )


def _format_failure(truth: frozenset[Finding]) -> Score:
    by_category = {
        name: _category_score(frozenset(f for f in truth if f[0] == name), frozenset())
        for name in CATEGORIES
    }
    return Score(
        precision=0.0,
        recall=0.0,
        f1=0.0,
        by_category=by_category,
        missed=tuple(sorted(truth)),
        extra=(),
        format_failure=True,
    )


def score_report(report_path: Path, answer_path: Path, *, log: Logger) -> Score:
    """Scores the agent's report against the answer key.

    An unreadable or invalid agent report is a format failure (zeros, every
    truth finding missed). An invalid answer key is a lab bug and raises
    `ReportError`.
    """
    try:
        log.info(
            "Scoring report...",
            report_path=str(report_path),
            answer_path=str(answer_path),
        )
        truth = flatten(load_report(answer_path))
        try:
            found: frozenset[Finding] | None = flatten(load_report(report_path))
        except ReportError:
            log.warning("Report is unusable.", report_path=str(report_path))
            found = None
    except ReportError:
        log.exception("Scoring report failed.", answer_path=str(answer_path))
        raise
    else:
        score = _format_failure(truth) if found is None else _compare(truth, found)
        log.info(
            "Scoring report succeeded.",
            f1=score.f1,
            missed=len(score.missed),
            extra=len(score.extra),
            format_failure=score.format_failure,
        )
        return score
