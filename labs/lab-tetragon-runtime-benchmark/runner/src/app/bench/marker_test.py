"""Tests for BENCH_ACTION marker parsing."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.bench.marker import parse_marker
from app.errors import MarkerMissingError


def test_parses_first_marker() -> None:
    out = "noise\nBENCH_ACTION 1700000000123\nBENCH_ACTION 1700000009999\n"
    assert parse_marker(out) == datetime(2023, 11, 14, 22, 13, 20, 123000, tzinfo=UTC)


def test_missing_marker_raises() -> None:
    with pytest.raises(MarkerMissingError):
        parse_marker("kubectl: pod not found\n")
