from __future__ import annotations

import sys
import time

import pytest

from app.errors import KubeError
from app.kube.events import EventStream
from app.logging_setup import get_logger

LOG = get_logger()


def _py(code: str) -> list[str]:
    return [sys.executable, "-c", code]


def test_snapshot_raises_when_process_exited() -> None:
    with EventStream(log=LOG, command=_py("pass"), attach_wait_s=0.5) as stream:
        time.sleep(0.5)
        with pytest.raises(KubeError):
            stream.snapshot()


def test_snapshot_works_while_process_runs() -> None:
    code = "import time; time.sleep(30)"
    with EventStream(log=LOG, command=_py(code), attach_wait_s=0.2) as stream:
        assert stream.snapshot() == ()


def test_invalid_utf8_does_not_kill_reader() -> None:
    code = (
        "import sys, time; sys.stdout.buffer.write(b'\\xff\\xfe not json\\n');"
        "sys.stdout.flush(); time.sleep(30)"
    )
    with EventStream(log=LOG, command=_py(code), attach_wait_s=0.5) as stream:
        assert stream.snapshot() == ()


def test_enter_cleans_up_child_when_attach_is_interrupted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream = EventStream(
        log=LOG, command=_py("import time; time.sleep(30)"), attach_wait_s=0.1
    )

    real_sleep = time.sleep

    def interrupt(_seconds: float) -> None:
        # Interrupt only the attach wait; cleanup's own waits must still work.
        monkeypatch.setattr(time, "sleep", real_sleep)
        raise KeyboardInterrupt

    monkeypatch.setattr(time, "sleep", interrupt)
    with pytest.raises(KeyboardInterrupt):
        stream.__enter__()
    assert stream._proc is not None
    assert stream._proc.poll() is not None
