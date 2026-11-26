from __future__ import annotations

import json

from app.answers.kev_answer import KevItem
from app.scoring.kev_score import score_kev
from app.truth.kev import KevTruth

_TRUTH = KevTruth(
    window_start="2026-10-01",
    window_end="2026-10-31",
    catalog_version="v",
    entries=(
        KevItem("CVE-2026-0001", "Palo Alto Networks", "PAN-OS"),
        KevItem("CVE-2026-0002", "Microsoft", "Windows"),
        KevItem("CVE-2026-0003", "Cisco", "IOS"),
        KevItem("CVE-2026-0004", "Apache", "Tomcat"),
    ),
)


def _report(*cves: tuple[str, str]) -> str:
    items = [{"cve_id": c, "vendor": v, "product": "x"} for c, v in cves]
    return "```json\n" + json.dumps({"cves": items}) + "\n```"


def _truth_pairs(count: int) -> list[tuple[str, str]]:
    return [(e.cve_id, e.vendor) for e in _TRUTH.entries[:count]]


def test_perfect_answer() -> None:
    score = score_kev(_report(*_truth_pairs(4)), _TRUTH)
    assert not score.format_failure
    assert (score.precision, score.recall, score.f1) == (1.0, 1.0, 1.0)
    assert score.vendor_accuracy == 1.0
    assert score.primary == 1.0
    assert score.missed == () and score.extra == ()


def test_two_correct_one_extra() -> None:
    pairs = [*_truth_pairs(2), ("CVE-2026-9999", "Other")]
    score = score_kev(_report(*pairs), _TRUTH)
    assert score.precision == 2 / 3
    assert score.recall == 0.5
    assert abs(score.f1 - 4 / 7) < 1e-9
    assert score.extra == ("CVE-2026-9999",)
    assert score.missed == ("CVE-2026-0003", "CVE-2026-0004")


def test_duplicates_and_case_variants_count_once() -> None:
    pairs = [
        ("CVE-2026-0001", "Palo Alto Networks"),
        ("cve-2026-0001 ", "Palo Alto Networks"),
        ("CVE-2026-0001", "Palo Alto Networks"),
    ]
    score = score_kev(_report(*pairs), _TRUTH)
    assert score.precision == 1.0
    assert score.recall == 0.25
    assert score.extra == ()


def test_vendor_normalised() -> None:
    score = score_kev(_report(("CVE-2026-0001", "palo   alto networks ")), _TRUTH)
    assert score.vendor_accuracy == 1.0
    assert score.vendor_mismatches == ()


def test_vendor_mismatch_listed() -> None:
    score = score_kev(_report(("CVE-2026-0002", "Microsoft Corp")), _TRUTH)
    assert score.vendor_accuracy == 0.0
    assert score.vendor_mismatches == (
        ("CVE-2026-0002", "Microsoft Corp", "Microsoft"),
    )


def test_empty_list_is_valid_zero() -> None:
    score = score_kev(_report(), _TRUTH)
    assert not score.format_failure
    assert (score.precision, score.recall, score.f1, score.vendor_accuracy) == (
        0,
        0,
        0,
        0,
    )


def test_malformed_is_format_failure_with_mentions() -> None:
    report = "We found CVE-2026-0001 and cve-2026-0002 but no block."
    score = score_kev(report, _TRUTH)
    assert score.format_failure
    assert score.f1 == 0.0
    assert score.mentioned_recall == 0.5
    assert score.missed == ()
