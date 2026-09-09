"""The one sanctioned way to put human-readable text on stdout."""

from __future__ import annotations

import pytest

from app import output


def test_write_line_writes_exactly_one_line(
    capsys: pytest.CaptureFixture[str],
) -> None:
    output.write_line("Scoreboard")
    assert capsys.readouterr().out == "Scoreboard\n"


def test_write_line_preserves_an_embedded_block(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The scoreboard arrives as one pre-rendered multi-line string."""
    output.write_line("a\nb")
    assert capsys.readouterr().out == "a\nb\n"
