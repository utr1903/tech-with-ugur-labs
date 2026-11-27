from __future__ import annotations

import json
import shutil
from collections.abc import Callable, Iterator
from datetime import datetime
from pathlib import Path

import pytest

from app.commands.run import RunArgs, run
from app.envvars import Settings
from app.errors import HermesError
from app.fixtures.writer import write_fixtures
from app.hermes.home import save_baseline, snapshot_path
from app.hermes.models import RunEvent, SessionRow
from app.hermes.review import ReviewOutcome
from app.logging_setup import get_logger

LOG = get_logger()


def _call(tool: str, **args: object) -> dict[str, object]:
    return {"function": {"name": tool, "arguments": json.dumps(args)}}


def _assistant(*calls: dict[str, object]) -> dict[str, object]:
    return {"role": "assistant", "tool_calls": list(calls)}


def _write_skill(home: Path, name: str, body: str = "v1") -> None:
    path = home / "skills" / name / "SKILL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\nname: {name}\ndescription: d\n---\n{body}\n")


class FakeHermes:
    def __init__(self, tmp: Path, cell: str, settings: Settings) -> None:
        self.settings, self.cell = settings, cell
        self.write_report = True
        self.fail_stream = False
        self.on_start: list[Callable[[], None]] = []
        self.starts: list[tuple[str, str | None]] = []
        self.children: list[SessionRow] = []
        self.msgs: dict[str, list[dict[str, object]]] = {}

    def health(self) -> dict[str, object]:
        return {"version": "9.9"}

    def start_run(self, input_text: str, *, session_id: str | None = None) -> str:
        self.starts.append((input_text, session_id))
        if session_id is None and self.write_report:
            answer = self.settings.data_dir / "answers" / "week-1.json"
            out = self.settings.out_dir / self.cell / "report.json"
            shutil.copyfile(answer, out)
        if self.on_start:
            self.on_start.pop(0)()
        return f"run_{len(self.starts)}"

    def stream_events(self, run_id: str, *, timeout_s: float) -> Iterator[RunEvent]:
        yield RunEvent("tool.started", 1, {"tool": "terminal"})
        if self.fail_stream:
            raise HermesError("deadline")
        usage = {"input_tokens": 100, "output_tokens": 10}
        yield RunEvent("run.completed", 2, {"usage": usage})

    def sessions(
        self, *, include_children: bool = True, limit: int = 200
    ) -> list[SessionRow]:
        parent = SessionRow("run_1", "api", None, "m1", 999, 9, 1)
        return [parent, *self.children]

    def messages(self, session_id: str) -> list[dict[str, object]]:
        return self.msgs.get(session_id, [])


def _setup(tmp_path: Path, cell: str) -> tuple[Settings, FakeHermes, Path]:
    s = Settings(
        "u",
        "k" * 16,
        tmp_path / "data",
        tmp_path / "res",
        tmp_path / "out",
        tmp_path / "home",
        tmp_path / "adc",
    )
    write_fixtures(s.data_dir, log=LOG)
    s.hermes_home.mkdir()
    _write_skill(s.hermes_home, "bundled")
    save_baseline(s.hermes_home, snapshot_path(s.results_dir, "h"), log=LOG)
    return s, FakeHermes(tmp_path, cell, s), s.hermes_home


def _args(cell: str, *, follow_up_if_no_skill: bool = False) -> RunArgs:
    return RunArgs(cell, "week-1", "h", follow_up_if_no_skill)


def _wait(
    calls: list[datetime],
) -> Callable[..., ReviewOutcome]:
    def wait(
        _log: Path, _sid: str, *, started_after: datetime, log: object
    ) -> ReviewOutcome:
        calls.append(started_after)
        return ReviewOutcome("none", 0, 5, 1)

    return wait


def test_cold_follow_up_when_no_skill(tmp_path: Path) -> None:
    s, fake, home = _setup(tmp_path, "full-cold")
    fake.on_start = [lambda: None, lambda: _write_skill(home, "triage")]
    waits: list[datetime] = []

    rec = run(
        s,
        _args("full-cold", follow_up_if_no_skill=True),
        client=fake,
        log=LOG,
        wait=_wait(waits),
    )

    assert rec.learning_path == "follow-up"
    assert fake.starts[1][1] == "run_1" and "skill" in fake.starts[1][0]
    assert rec.follow_up and rec.follow_up["run_id"] == "run_2"
    assert rec.agent_created_skills == ["triage"]
    assert len(waits) == 2 and rec.score["f1"] == 1.0
    run_dir = s.results_dir / "full-cold" / "r1"
    assert (run_dir / "skills" / "triage" / "SKILL.md").is_file()
    assert (run_dir / "follow_up_events.jsonl").is_file()
    assert json.loads((run_dir / "run.json").read_text())["hermes_version"] == "9.9"


def test_cold_no_follow_up_when_skill_created(tmp_path: Path) -> None:
    s, fake, home = _setup(tmp_path, "full-cold")
    fake.on_start = [lambda: _write_skill(home, "triage")]

    rec = run(
        s,
        _args("full-cold", follow_up_if_no_skill=True),
        client=fake,
        log=LOG,
        wait=_wait([]),
    )

    assert rec.learning_path == "unprompted"
    assert len(fake.starts) == 1 and rec.follow_up is None
    assert rec.model == "m1" and rec.parent_tokens == {"input": 100, "output": 10}


def test_cold_without_flag_is_none(tmp_path: Path) -> None:
    s, fake, _ = _setup(tmp_path, "flat-cold")
    rec = run(s, _args("flat-cold"), client=fake, log=LOG, wait=_wait([]))
    assert rec.learning_path == "none" and rec.config == "flat"
    assert (
        run(s, _args("flat-cold"), client=fake, log=LOG, wait=_wait([])).repeat == "r2"
    )


def test_warm_detects_skill_loaded_and_patched(tmp_path: Path) -> None:
    s, fake, home = _setup(tmp_path, "full-warm")
    _write_skill(home, "triage")
    fake.msgs["run_1"] = [_assistant(_call("skill_view", name="triage"))]
    fake.on_start = [lambda: _write_skill(home, "triage", "v2")]

    rec = run(s, _args("full-warm"), client=fake, log=LOG, wait=_wait([]))

    assert rec.skills_before == ["triage"] and rec.learning_path == "n/a"
    assert rec.skill_loaded and rec.skill_patched


def test_children_tokens_summed(tmp_path: Path) -> None:
    s, fake, _ = _setup(tmp_path, "full-control")
    fake.children = [
        SessionRow("c1", "api", "run_1", "m", 10, 1, 2),
        SessionRow("c2", "api", "run_1", "m", 20, 2, 1),
        SessionRow("x", "api", "other", "m", 500, 5, 1),
    ]
    fake.msgs["c1"] = [_assistant(_call("terminal"), _call("execute_code"))]
    fake.msgs["c2"] = [_assistant(_call("terminal"))]

    rec = run(s, _args("full-control"), client=fake, log=LOG, wait=_wait([]))

    assert rec.children_tokens == {"input": 30, "output": 3}
    assert rec.children_tools == {"terminal": 2, "execute_code": 1}
    assert rec.tools == {"terminal": 3, "execute_code": 1}
    assert rec.parent_tools == {"terminal": 1}


def test_missing_report_records_format_failure(tmp_path: Path) -> None:
    s, fake, _ = _setup(tmp_path, "full-control")
    fake.write_report = False
    rec = run(s, _args("full-control"), client=fake, log=LOG, wait=_wait([]))
    assert rec.score["format_failure"] is True
    assert rec.error == "report.json was not written"
    assert (s.results_dir / "full-control" / "r1" / "run.json").is_file()


def test_stream_error_is_recorded_not_raised(tmp_path: Path) -> None:
    s, fake, _ = _setup(tmp_path, "full-control")
    fake.fail_stream = True
    waits: list[datetime] = []
    rec = run(s, _args("full-control"), client=fake, log=LOG, wait=_wait(waits))
    assert rec.status == "error" and rec.error == "deadline" and not waits
    lines = (s.results_dir / "full-control/r1/events.jsonl").read_text().splitlines()
    assert json.loads(lines[0])["event"] == "tool.started"
    with pytest.raises(Exception, match="Unknown cell"):
        run(s, _args("bogus"), client=fake, log=LOG)
