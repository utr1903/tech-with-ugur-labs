from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import override

from app.cells.stream import stream_to_file
from app.errors import HermesError
from app.hermes.client import HermesApi
from app.hermes.models import RunEvent, SessionRow
from app.logging_setup import get_logger

LOG = get_logger()


class FakeApi(HermesApi):
    """Streams one tool event, then fails or completes; records stops."""

    def __init__(self, *, fail: bool, stop_fails: bool = False) -> None:
        self.fail, self.stop_fails = fail, stop_fails
        self.stopped: list[str] = []
        self.streams: list[float] = []

    @override
    def health(self) -> dict[str, object]:
        return {}

    @override
    def start_run(self, input_text: str, *, session_id: str | None = None) -> str:
        return "run_1"

    @override
    def stream_events(self, run_id: str, *, timeout_s: float) -> Iterator[RunEvent]:
        self.streams.append(timeout_s)
        yield RunEvent("tool.started", 1, {"tool": "terminal"})
        if self.stopped:
            yield RunEvent("run.cancelled", 2, {})
            return
        if self.fail:
            raise HermesError("Run run_1 passed its 1800.0s deadline.")
        yield RunEvent("run.completed", 2, {"usage": {"input_tokens": 3}})

    @override
    def stop_run(self, run_id: str) -> str:
        self.stopped.append(run_id)
        if self.stop_fails:
            raise HermesError("POST /v1/runs/run_1/stop returned 409")
        return "stopping"

    @override
    def sessions(
        self, *, include_children: bool = True, limit: int = 200
    ) -> list[SessionRow]:
        return []

    @override
    def messages(self, session_id: str) -> list[dict[str, object]]:
        return []


def test_completed_run_is_not_stopped(tmp_path: Path) -> None:
    api = FakeApi(fail=False)
    out = stream_to_file(api, "run_1", tmp_path / "e.jsonl", log=LOG)
    assert out.status == "run.completed" and out.input_tokens == 3
    assert api.stopped == [] and len(api.streams) == 1


def test_failed_stream_stops_the_run_and_waits(tmp_path: Path) -> None:
    api = FakeApi(fail=True)
    out = stream_to_file(api, "run_1", tmp_path / "e.jsonl", log=LOG)
    assert api.stopped == ["run_1"]
    assert len(api.streams) == 2 and api.streams[1] <= 120.0
    # The cell still counts as failed, with the original reason.
    assert out.status == "error" and out.error is not None
    assert "deadline" in out.error
    lines = (tmp_path / "e.jsonl").read_text().splitlines()
    assert [json.loads(ln)["event"] for ln in lines] == ["tool.started"]


def test_refused_stop_is_logged_not_raised(tmp_path: Path) -> None:
    api = FakeApi(fail=True, stop_fails=True)
    out = stream_to_file(api, "run_1", tmp_path / "e.jsonl", log=LOG)
    assert api.stopped == ["run_1"] and out.status == "error"
