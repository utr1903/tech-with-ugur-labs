"""The entrypoint rejects what it does not recognise, and turns a failed
check into the exit code the README promises scripters."""

from __future__ import annotations

import pytest

from app import __main__ as entrypoint
from app.errors import ChecksFailedError
from app.logging_setup import Logger


def test_unknown_command_is_rejected() -> None:
    with pytest.raises(SystemExit) as exit_info:
        entrypoint.main(["nonsense"])
    assert exit_info.value.code != 0


def test_a_failed_check_exits_1(monkeypatch: pytest.MonkeyPatch) -> None:
    """A LabError raised by a command must exit 1, not propagate or exit 0.

    This is the exit-code contract the README documents for scripters:
    `ChecksFailedError` is caught by `main`, logged, and mapped to exit 1.
    """

    def _raise_checks_failed(*, log: Logger) -> None:
        log.info("Standing in for a command that failed a hard check.")
        raise ChecksFailedError("1 check(s) failed")

    monkeypatch.setitem(entrypoint.COMMANDS, "report", _raise_checks_failed)

    assert entrypoint.main(["report"]) == 1
