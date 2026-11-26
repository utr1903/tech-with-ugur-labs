from __future__ import annotations

from pathlib import Path

import pytest

from app.answers.kev_answer import KevItem
from app.errors import TruthError
from app.logging_setup import Logger, get_logger
from app.truth.edgar import MsftTruth, QuarterTruth
from app.truth.kev import KevTruth
from app.truth.store import (
    kev_truth_to_json,
    load_kev_truth,
    load_msft_truth,
    msft_truth_to_json,
    write_truth,
)


@pytest.fixture
def log() -> Logger:
    return get_logger()


def _kev() -> KevTruth:
    return KevTruth(
        "2026-10-01",
        "2026-10-31",
        "2026.11.03",
        (KevItem("CVE-2026-1001", "Initech", "Hub"),),
    )


def _msft() -> MsftTruth:
    return MsftTruth(
        "0000789019",
        (
            QuarterTruth("2025-03-31", 70066.0, 25824.0, 3.46, False),
            QuarterTruth("2025-06-30", 76441.0, 27233.0, 3.65, True),
        ),
    )


def test_second_identical_write_changes_nothing(tmp_path: Path, log: Logger) -> None:
    path = tmp_path / "out.json"
    payload = kev_truth_to_json(_kev())

    assert write_truth(path, payload, log=log) is True
    first = path.read_bytes()
    assert write_truth(path, payload, log=log) is False
    assert path.read_bytes() == first
    assert first.endswith(b"\n")


def test_kev_round_trip(tmp_path: Path, log: Logger) -> None:
    path = tmp_path / "kev.json"
    write_truth(path, kev_truth_to_json(_kev()), log=log)

    assert load_kev_truth(path) == _kev()


def test_msft_round_trip(tmp_path: Path, log: Logger) -> None:
    path = tmp_path / "msft.json"
    write_truth(path, msft_truth_to_json(_msft()), log=log)

    assert load_msft_truth(path) == _msft()


def test_load_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(TruthError):
        load_kev_truth(tmp_path / "absent.json")


def test_load_malformed_file_raises(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text('{"entries": 3}')

    with pytest.raises(TruthError):
        load_kev_truth(path)
    with pytest.raises(TruthError):
        load_msft_truth(path)
