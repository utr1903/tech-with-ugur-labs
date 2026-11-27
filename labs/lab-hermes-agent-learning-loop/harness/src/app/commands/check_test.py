from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import override

import pytest

from app.commands.check import EXPECTED_VERSION, run
from app.envvars import Settings
from app.errors import HermesError
from app.hermes.client import HermesApi
from app.hermes.home import snapshot_path
from app.hermes.models import RunEvent, SessionRow
from app.logging_setup import get_logger

LOG = get_logger()
MODEL = "google/gemma-4-26b-a4b-it-maas"


class FakeHermes(HermesApi):
    def __init__(self) -> None:
        self.health_docs: list[dict[str, object]] = []
        self.model = MODEL
        self.terminal = "run.completed"
        self.prompts: list[str] = []

    @override
    def health(self) -> dict[str, object]:
        if len(self.health_docs) > 1:
            return self.health_docs.pop(0)
        return self.health_docs[0]

    @override
    def start_run(self, input_text: str, *, session_id: str | None = None) -> str:
        del session_id
        self.prompts.append(input_text)
        return "run_probe"

    @override
    def stream_events(self, run_id: str, *, timeout_s: float) -> Iterator[RunEvent]:
        del run_id, timeout_s
        yield RunEvent(self.terminal, 1, {})

    @override
    def stop_run(self, run_id: str) -> str:
        return "stopping"

    @override
    def sessions(
        self, *, include_children: bool = True, limit: int = 200
    ) -> list[SessionRow]:
        del include_children, limit
        return [
            SessionRow("other", "api", None, "x", 0, 0, 0),
            SessionRow("run_probe", "api", None, self.model, 1, 1, 0),
        ]

    @override
    def messages(self, session_id: str) -> list[dict[str, object]]:
        del session_id
        return []


def _setup(tmp_path: Path) -> tuple[Settings, FakeHermes]:
    s = Settings(
        "u",
        "k" * 16,
        tmp_path / "data",
        tmp_path / "res",
        tmp_path / "out",
        tmp_path / "home",
        tmp_path / "adc",
    )
    skill = s.hermes_home / "skills" / "bundled" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("---\nname: bundled\ndescription: d\n---\nx\n")
    fake = FakeHermes()
    fake.health_docs = [{"status": "ok", "version": EXPECTED_VERSION}]
    return s, fake


def _check(
    s: Settings, fake: FakeHermes, monotonic: Callable[[], float] = time.monotonic
) -> None:
    run(
        s,
        fake,
        home_name="h",
        expected_model=MODEL,
        log=LOG,
        sleep=lambda _: None,
        monotonic=monotonic,
    )


def test_check_creates_baseline_and_prints_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    s, fake = _setup(tmp_path)
    _check(s, fake)
    assert snapshot_path(s.results_dir, "h").is_file()
    assert fake.prompts == ["Reply with the single word ready."]
    last = capsys.readouterr().out.splitlines()[-1]
    assert last == f"Hermes {EXPECTED_VERSION} ready on {MODEL}; baseline created for h"


def test_check_wrong_version_fails(tmp_path: Path) -> None:
    s, fake = _setup(tmp_path)
    fake.health_docs = [{"status": "ok", "version": "0.1.0"}]
    with pytest.raises(HermesError, match="0.1.0"):
        _check(s, fake)


def test_check_wrong_model_fails(tmp_path: Path) -> None:
    s, fake = _setup(tmp_path)
    fake.model = "other/model"
    with pytest.raises(HermesError, match="other/model") as err:
        _check(s, fake)
    assert MODEL in str(err.value)


def test_check_keeps_existing_baseline(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    s, fake = _setup(tmp_path)
    dest = snapshot_path(s.results_dir, "h")
    dest.parent.mkdir(parents=True)
    dest.write_text('["skills/old/SKILL.md"]\n')
    _check(s, fake)
    assert dest.read_text() == '["skills/old/SKILL.md"]\n'
    assert "baseline kept for h" in capsys.readouterr().out


def test_check_waits_until_health_is_ready(tmp_path: Path) -> None:
    s, fake = _setup(tmp_path)
    fake.health_docs = [
        {"status": "starting", "version": EXPECTED_VERSION},
        {"status": "ok", "version": EXPECTED_VERSION},
    ]
    _check(s, fake)


def test_check_fails_when_health_never_ready(tmp_path: Path) -> None:
    s, fake = _setup(tmp_path)
    fake.health_docs = [{"status": "starting", "version": EXPECTED_VERSION}]
    ticks = iter(range(0, 1000, 20))
    with pytest.raises(HermesError, match="not ready"):
        _check(s, fake, lambda: float(next(ticks)))


def test_check_probe_must_complete(tmp_path: Path) -> None:
    s, fake = _setup(tmp_path)
    fake.terminal = "run.failed"
    with pytest.raises(HermesError, match="run.failed"):
        _check(s, fake)
