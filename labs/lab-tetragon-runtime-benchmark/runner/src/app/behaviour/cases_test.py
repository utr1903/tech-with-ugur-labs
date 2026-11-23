from __future__ import annotations

from datetime import UTC, datetime

from app.behaviour.cases import CASES, Case, delete_outcome, is_alert
from app.events.model import Event


def _case(name: str) -> Case:
    return next(c for c in CASES if c.case == name)


def _event(*, policy: str, function: str, pod: str = "victim") -> Event:
    return Event(
        kind="kprobe",
        time=datetime(2026, 1, 1, tzinfo=UTC),
        pod=pod,
        namespace="victim",
        binary="/usr/bin/x",
        arguments="",
        policy=policy,
        function=function,
        action=None,
    )


def test_sigkill_outcome_needs_rc_137_and_file_gone() -> None:
    ok, _ = delete_outcome("sigkill", "RM_RC=137\nFILE=gone\n")
    assert ok
    bad, _ = delete_outcome("sigkill", "RM_RC=137\nFILE=present\n")
    assert not bad


def test_override_outcome_needs_failure_and_file_present() -> None:
    ok, _ = delete_outcome("override", "RM_RC=1\nFILE=present\n")
    assert ok
    killed, _ = delete_outcome("override", "RM_RC=137\nFILE=present\n")
    assert not killed
    gone, _ = delete_outcome("override", "RM_RC=1\nFILE=gone\n")
    assert not gone


def test_missing_rm_result_is_not_ok() -> None:
    ok, detail = delete_outcome("sigkill", "nothing")
    assert not ok
    assert "missing" in detail


def test_stateful_alert_is_the_tcp_connect_event_only() -> None:
    case = _case("read-only")
    connect = _event(policy="demo-stateful-exfil", function="tcp_connect")
    opened = _event(policy="demo-stateful-exfil", function="security_file_open")
    assert is_alert(connect, case)
    assert not is_alert(opened, case)


def test_alert_requires_the_cases_policy_and_pod() -> None:
    case = _case("rce")
    assert is_alert(
        _event(policy="demo-lineage", function="__x64_sys_execve", pod="webapp"), case
    )
    assert not is_alert(
        _event(policy="other", function="__x64_sys_execve", pod="webapp"), case
    )
    assert not is_alert(
        _event(policy="demo-lineage", function="__x64_sys_execve"), case
    )
