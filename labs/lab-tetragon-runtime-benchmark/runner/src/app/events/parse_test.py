"""Tests for parsing Tetragon export lines."""

from __future__ import annotations

import json
from pathlib import Path

from app.events.parse import parse_event

FIXTURES = Path(__file__).parent / "fixtures"


def _line(name: str) -> str:
    return (FIXTURES / name).read_text().strip()


def test_parses_exec_fixture() -> None:
    event = parse_event(_line("exec.jsonl"))

    assert event is not None
    assert event.kind == "exec"
    assert event.pod == "victim"
    assert event.namespace == "victim"
    assert event.binary == "/tmp/hello"
    assert event.arguments == ""
    assert event.policy is None
    assert event.time.tzinfo is not None


def test_parses_kprobe_fixture() -> None:
    event = parse_event(_line("kprobe.jsonl"))

    assert event is not None
    assert event.kind == "kprobe"
    assert event.policy == "cred-files"
    assert event.function == "security_file_open"
    assert event.action == "KPROBE_ACTION_OVERRIDE"
    assert event.binary == "/usr/bin/cat"
    assert event.arguments == "/etc/shadow"


def test_returns_none_for_truncated_line() -> None:
    assert parse_event(_line("exec.jsonl")[:200]) is None


def test_returns_none_for_non_json_and_non_object() -> None:
    assert parse_event("not json at all") is None
    assert parse_event("[1, 2]") is None
    assert parse_event("") is None


def test_returns_none_for_process_exit() -> None:
    assert parse_event(_line("exit.jsonl")) is None


def test_returns_none_without_pod() -> None:
    raw = json.loads(_line("exec.jsonl"))
    del raw["process_exec"]["process"]["pod"]

    assert parse_event(json.dumps(raw)) is None


def test_returns_none_for_unparseable_time() -> None:
    raw = json.loads(_line("exec.jsonl"))
    raw["time"] = "yesterday"

    assert parse_event(json.dumps(raw)) is None
