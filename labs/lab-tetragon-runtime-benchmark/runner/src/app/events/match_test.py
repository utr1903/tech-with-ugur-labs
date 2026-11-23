"""Tests for matching events against scenario signals."""

from __future__ import annotations

from datetime import UTC, datetime

from app.events.match import matches
from app.events.model import Event
from app.scenarios.model import Matcher

EXEC = Event(
    kind="exec",
    time=datetime(2026, 11, 23, tzinfo=UTC),
    pod="victim",
    namespace="victim",
    binary="/tmp/hello",
    arguments="-c id",
    policy=None,
    function=None,
    action=None,
)
KPROBE = Event(
    kind="kprobe",
    time=datetime(2026, 11, 23, tzinfo=UTC),
    pod="victim",
    namespace="victim",
    binary="/usr/bin/cat",
    arguments="/etc/shadow",
    policy="cred-files",
    function="security_file_open",
    action="KPROBE_ACTION_OVERRIDE",
)


def _matcher(
    kind: str = "exec",
    *,
    policy: str | None = None,
    binary_prefix: str | None = None,
    binary_regex: str | None = None,
    args_regex: str | None = None,
) -> Matcher:
    return Matcher(
        kind="kprobe" if kind == "kprobe" else "exec",
        policy=policy,
        binary_prefix=binary_prefix,
        binary_regex=binary_regex,
        args_regex=args_regex,
    )


def test_exec_prefix_matches() -> None:
    assert matches(EXEC, _matcher(binary_prefix="/tmp/"))
    assert not matches(EXEC, _matcher(binary_prefix="/usr/"))


def test_kprobe_requires_same_policy() -> None:
    assert matches(KPROBE, _matcher("kprobe", policy="cred-files"))
    assert not matches(KPROBE, _matcher("kprobe", policy="other"))


def test_exec_matcher_ignores_kprobe_event() -> None:
    assert not matches(KPROBE, _matcher(binary_prefix="/usr/"))


def test_all_set_fields_must_match() -> None:
    both = _matcher(binary_prefix="/tmp/", args_regex=r"-c\s+id")
    assert matches(EXEC, both)
    assert not matches(EXEC, _matcher(binary_prefix="/tmp/", args_regex="nope"))
    assert not matches(EXEC, _matcher(binary_prefix="/usr/", args_regex="id"))


def test_binary_regex_uses_search() -> None:
    assert matches(EXEC, _matcher(binary_regex=r"hel+o$"))
    assert not matches(EXEC, _matcher(binary_regex=r"^hello"))
