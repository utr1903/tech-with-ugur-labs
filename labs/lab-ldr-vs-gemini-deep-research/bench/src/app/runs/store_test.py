from __future__ import annotations

from pathlib import Path

import pytest

from app.errors import RunStoreError
from app.logging_setup import Logger, get_logger
from app.runs.record import RunRecord
from app.runs.store import load_runs, next_run_numbers, run_path, save_run


@pytest.fixture
def log() -> Logger:
    return get_logger()


def _record(tool: str = "ldr", qid: str = "q1-kev", run: int = 1) -> RunRecord:
    return RunRecord(
        tool=tool,
        question_id=qid,
        run=run,
        started_at="2026-11-01T10:00:00Z",
        wall_seconds=1.5,
        status="completed",
        report="Ünïcode report",
        sources=("https://a.example",),
        usage={"tokens": 3},
        cost_usd=0.25,
        meta={},
    )


def test_run_path_layout(tmp_path: Path) -> None:
    assert run_path(tmp_path, "gemini", "q2-msft", 3) == (
        tmp_path / "runs" / "gemini" / "q2-msft" / "run-3.json"
    )


def test_save_then_load_round_trip(tmp_path: Path, log: Logger) -> None:
    record = _record()

    path = save_run(tmp_path, record, overwrite=False, log=log)

    assert path == run_path(tmp_path, "ldr", "q1-kev", 1)
    assert load_runs(tmp_path, log=log) == (record,)


def test_save_leaves_no_temporary_file(tmp_path: Path, log: Logger) -> None:
    path = save_run(tmp_path, _record(), overwrite=False, log=log)
    save_run(tmp_path, _record(), overwrite=True, log=log)

    assert sorted(p.name for p in path.parent.iterdir()) == ["run-1.json"]


def test_failed_write_keeps_the_previous_file(
    tmp_path: Path, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = save_run(tmp_path, _record(), overwrite=False, log=log)
    before = path.read_text(encoding="utf-8")

    def broken(*_: object) -> Path:
        raise OSError("disk full")

    monkeypatch.setattr(Path, "replace", broken)
    newer = RunRecord(**{**_record().__dict__, "report": "new"})

    with pytest.raises(RunStoreError):
        save_run(tmp_path, newer, overwrite=True, log=log)

    assert path.read_text(encoding="utf-8") == before
    assert [p.name for p in path.parent.iterdir()] == ["run-1.json"]


def test_file_is_stable_and_unescaped(tmp_path: Path, log: Logger) -> None:
    path = save_run(tmp_path, _record(), overwrite=False, log=log)

    text = path.read_text(encoding="utf-8")

    assert "Ünïcode" in text
    assert text.endswith("}\n")
    assert text.index('"cost_usd"') < text.index('"wall_seconds"')


def test_save_existing_without_overwrite_raises(tmp_path: Path, log: Logger) -> None:
    save_run(tmp_path, _record(), overwrite=False, log=log)

    with pytest.raises(RunStoreError):
        save_run(tmp_path, _record(), overwrite=False, log=log)


def test_save_existing_with_overwrite_replaces(tmp_path: Path, log: Logger) -> None:
    save_run(tmp_path, _record(), overwrite=False, log=log)
    newer = _record()
    newer = RunRecord(**{**newer.__dict__, "report": "new"})

    save_run(tmp_path, newer, overwrite=True, log=log)

    assert load_runs(tmp_path, log=log)[0].report == "new"


def test_next_run_numbers_fills_gaps(tmp_path: Path, log: Logger) -> None:
    save_run(tmp_path, _record(run=1), overwrite=False, log=log)
    save_run(tmp_path, _record(run=3), overwrite=False, log=log)

    assert next_run_numbers(tmp_path, "ldr", "q1-kev", 2) == (2, 4)


def test_next_run_numbers_on_empty_dir(tmp_path: Path) -> None:
    assert next_run_numbers(tmp_path, "ldr", "q1-kev", 3) == (1, 2, 3)


def test_load_missing_dir_is_empty(tmp_path: Path, log: Logger) -> None:
    assert load_runs(tmp_path / "nope", log=log) == ()


def test_load_sorted_and_ignores_other_files(tmp_path: Path, log: Logger) -> None:
    save_run(tmp_path, _record("ldr", "q2-msft", 10), overwrite=False, log=log)
    save_run(tmp_path, _record("ldr", "q2-msft", 2), overwrite=False, log=log)
    save_run(tmp_path, _record("gemini", "q1-kev", 1), overwrite=False, log=log)
    (run_path(tmp_path, "ldr", "q2-msft", 1).parent / "notes.json").write_text("{")

    runs = load_runs(tmp_path, log=log)

    assert [(r.tool, r.question_id, r.run) for r in runs] == [
        ("gemini", "q1-kev", 1),
        ("ldr", "q2-msft", 2),
        ("ldr", "q2-msft", 10),
    ]


def test_corrupt_file_names_path(tmp_path: Path, log: Logger) -> None:
    path = run_path(tmp_path, "ldr", "q1-kev", 1)
    path.parent.mkdir(parents=True)
    path.write_text("{not json", encoding="utf-8")

    with pytest.raises(RunStoreError, match="run-1.json"):
        load_runs(tmp_path, log=log)
