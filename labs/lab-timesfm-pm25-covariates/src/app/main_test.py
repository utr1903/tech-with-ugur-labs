"""The entrypoint rejects what it does not recognise."""

from __future__ import annotations

import pytest

from app import __main__ as entrypoint


def test_unknown_command_is_rejected() -> None:
    with pytest.raises(SystemExit) as exit_info:
        entrypoint.main(["nonsense"])
    assert exit_info.value.code != 0
