from __future__ import annotations

import json
import sys
import threading

import pytest

from app.__main__ import build_parser, main


def test_parser_registers_every_command() -> None:
    parser = build_parser()

    for name in ("fixtures", "check", "report", "leak-check"):
        assert parser.parse_args([name]).command == name


def test_run_command_takes_cell_week_home_and_flags() -> None:
    args = build_parser().parse_args(
        ["run", "--cell", "full-cold", "--week", "week-1", "--home", "h"]
    )
    assert (args.cell, args.week, args.home) == ("full-cold", "week-1", "h")
    assert args.follow_up_if_no_skill is False and args.repeat_label is None


def test_fixtures_command_accepts_check_flag() -> None:
    parser = build_parser()

    assert parser.parse_args(["fixtures"]).check is False
    assert parser.parse_args(["fixtures", "--check"]).check is True


def test_unimplemented_command_exits_1_and_logs_json(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # main() installs process-wide error hooks; restore them afterwards.
    monkeypatch.setattr(sys, "excepthook", sys.excepthook)
    monkeypatch.setattr(threading, "excepthook", threading.excepthook)
    monkeypatch.setattr("sys.argv", ["app", "check"])

    assert main() == 1

    last = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert last["event"] == "Command failed."
    assert last["command"] == "check"
    assert "not implemented yet" in json.dumps(last["exception"])
