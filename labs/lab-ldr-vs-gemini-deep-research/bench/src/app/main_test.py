"""Tests for argument parsing and exit-code mapping."""

from __future__ import annotations

import argparse

import pytest

from app.__main__ import build_parser, main
from app.errors import RunStoreError
from app.logging_setup import Logger


def test_parser_accepts_each_command() -> None:
    parser = build_parser()

    args = parser.parse_args(["research", "--question", "q1-kev", "--runs", "2"])
    assert args.command == "research"
    assert args.question == "q1-kev"
    assert args.runs == 2

    defaults = parser.parse_args(["research"])
    assert defaults.question == "all"
    assert defaults.runs == 3
    assert defaults.overwrite is False

    assert parser.parse_args(["truth", "--check"]).check is True
    assert parser.parse_args(["frontier"]).command == "frontier"
    assert parser.parse_args(["score"]).command == "score"
    assert parser.parse_args(["check"]).command == "check"


def test_parser_rejects_unknown_question() -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(["research", "--question", "q3-nope"])


def test_lab_error_maps_to_exit_1(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(args: argparse.Namespace, *, log: Logger) -> None:
        log.info("Simulating a broken run file.", command=args.command)
        raise RunStoreError("broken run file")

    monkeypatch.setattr("app.commands.score.run", fail)
    monkeypatch.setattr("sys.argv", ["app", "score"])

    assert main() == 1
