from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from app.answers.kev_answer import KevItem
from app.errors import TruthError
from app.truth.kev import build_kev_truth

_FIXTURE = Path(__file__).parent / "fixtures" / "kev_sample.json"


def _feed() -> dict[str, object]:
    loaded: dict[str, object] = json.loads(_FIXTURE.read_text())
    return loaded


def test_window_is_inclusive_and_sorted() -> None:
    truth = build_kev_truth(_feed(), start=date(2026, 10, 1), end=date(2026, 10, 31))

    assert truth.entries == (
        KevItem("CVE-2026-1001", "Initech", "Hub"),
        KevItem("CVE-2026-1002", "Globex", "Gate"),
    )
    assert truth.window_start == "2026-10-01"
    assert truth.window_end == "2026-10-31"
    assert truth.catalog_version == "2026.11.03"


def test_feed_without_vulnerabilities_raises() -> None:
    with pytest.raises(TruthError):
        build_kev_truth(
            {"catalogVersion": "1"}, start=date(2026, 10, 1), end=date(2026, 10, 31)
        )
