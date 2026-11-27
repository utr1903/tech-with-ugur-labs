from __future__ import annotations

import json
from pathlib import Path

from app.fixtures.generator import WEEKS
from app.fixtures.writer import check_fixtures, write_fixtures
from app.logging_setup import get_logger


def test_write_fixtures_creates_fleet_and_answers(tmp_path: Path) -> None:
    written = write_fixtures(tmp_path, log=get_logger())

    assert written > 0
    for week in WEEKS:
        assert (tmp_path / "fleet" / week / "RUNBOOK.md").is_file()
        answer = json.loads((tmp_path / "answers" / f"{week}.json").read_text())
        assert answer["week"] == week
        assert (tmp_path / "fleet" / week / "advisories.json").is_file()
        assert [s["service"] for s in answer["services"]] == sorted(
            s["service"] for s in answer["services"]
        )
    assert check_fixtures(tmp_path, log=get_logger()) == []


def test_check_fixtures_reports_modified_file(tmp_path: Path) -> None:
    write_fixtures(tmp_path, log=get_logger())
    log_file = tmp_path / "fleet/week-1/services/billing/access.log"
    log_file.write_text(log_file.read_text() + "extra\n")
    (tmp_path / "answers/week-2.json").unlink()

    assert check_fixtures(tmp_path, log=get_logger()) == [
        "answers/week-2.json",
        "fleet/week-1/services/billing/access.log",
    ]
