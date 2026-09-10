from __future__ import annotations

from app.commands import scoreboard
from app.eval.results import ExperimentResult


def test_scoreboard_lists_every_configuration_and_marks_the_cheat(
    results: dict[str, ExperimentResult],
) -> None:
    text = scoreboard.format_scoreboard(results)
    for name in results:
        assert name in text
    assert "MASE" in text
    # The leaky row must never read as a legitimate winner.
    leaky_line = next(line for line in text.splitlines() if "leaky-control" in line)
    assert "cheat" in leaky_line.lower() or "*" in leaky_line


def test_scoreboard_notes_are_not_truncated_on_a_decimal_point(
    results: dict[str, ExperimentResult],
) -> None:
    text = scoreboard.format_scoreboard(results)
    univariate_line = next(
        line for line in text.splitlines() if "timesfm-univariate" in line
    )
    assert "PM2.5" in univariate_line
