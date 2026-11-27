"""Scores a report's CVE list against the KEV answer key."""

from __future__ import annotations

from dataclasses import dataclass

from app.answers.kev_answer import mentioned_cves, parse_kev_answer
from app.truth.kev import KevTruth


@dataclass(frozen=True)
class KevScore:
    """Set metrics for the CVE list; vendor mismatches are (cve, answered, truth)."""

    format_failure: bool
    precision: float
    recall: float
    f1: float
    vendor_accuracy: float
    mentioned_recall: float
    missed: tuple[str, ...]
    extra: tuple[str, ...]
    vendor_mismatches: tuple[tuple[str, str, str], ...]

    @property
    def primary(self) -> float:
        """The headline number for this question."""
        return self.f1


def score_kev(report: str, truth: KevTruth) -> KevScore:
    """Compares the answered CVE set with the truth set."""
    truth_vendors = {
        entry.cve_id.strip().upper(): entry.vendor for entry in truth.entries
    }
    truth_ids = set(truth_vendors)
    mentioned = mentioned_cves(report)
    mentioned_recall = _ratio(len(mentioned & truth_ids), len(truth_ids))

    items = parse_kev_answer(report)
    if items is None:
        return KevScore(True, 0.0, 0.0, 0.0, 0.0, mentioned_recall, (), (), ())

    answered: dict[str, str] = {}
    for item in items:
        answered.setdefault(item.cve_id.strip().upper(), item.vendor)
    correct = set(answered) & truth_ids

    precision = _ratio(len(correct), len(answered))
    recall = _ratio(len(correct), len(truth_ids))
    f1 = _ratio(2 * precision * recall, precision + recall)

    mismatches = tuple(
        (cve, answered[cve], truth_vendors[cve])
        for cve in sorted(correct)
        if _vendor_key(answered[cve]) != _vendor_key(truth_vendors[cve])
    )
    vendor_accuracy = _ratio(len(correct) - len(mismatches), len(correct))
    return KevScore(
        format_failure=False,
        precision=precision,
        recall=recall,
        f1=f1,
        vendor_accuracy=vendor_accuracy,
        mentioned_recall=mentioned_recall,
        missed=tuple(sorted(truth_ids - set(answered))),
        extra=tuple(sorted(set(answered) - truth_ids)),
        vendor_mismatches=mismatches,
    )


def _vendor_key(vendor: str) -> str:
    return " ".join(vendor.casefold().split())


def _ratio(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0
