"""Reads and writes one JSON file per research run."""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.errors import RunStoreError
from app.logging_setup import Logger
from app.runs.record import RunRecord, record_from_json, record_to_json

_RUN_FILE = re.compile(r"run-(\d+)\.json")


def run_path(results_dir: Path, tool: str, qid: str, n: int) -> Path:
    """Where run `n` of `tool` on question `qid` is stored."""
    return results_dir / "runs" / tool / qid / f"run-{n}.json"


def next_run_numbers(
    results_dir: Path, tool: str, qid: str, count: int
) -> tuple[int, ...]:
    """The `count` smallest positive run numbers not yet used."""
    used = {n for n, _ in _run_files(run_path(results_dir, tool, qid, 1).parent)}
    free: list[int] = []
    candidate = 1
    while len(free) < count:
        if candidate not in used:
            free.append(candidate)
        candidate += 1
    return tuple(free)


def save_run(
    results_dir: Path, record: RunRecord, *, overwrite: bool, log: Logger
) -> Path:
    """Writes the record as stable, diff-friendly JSON and returns its path."""
    path = run_path(results_dir, record.tool, record.question_id, record.run)
    if path.exists() and not overwrite:
        raise RunStoreError(f"{path} already exists")

    try:
        log.info("Saving run...", path=str(path), status=record.status)
        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(
            record_to_json(record), indent=2, sort_keys=True, ensure_ascii=False
        )
        path.write_text(text + "\n", encoding="utf-8")
    except OSError as err:
        log.exception("Saving run failed.", path=str(path))
        raise RunStoreError(f"cannot write {path}: {err}") from err
    else:
        log.info("Saving run succeeded.", path=str(path))
        return path


def load_runs(results_dir: Path, *, log: Logger) -> tuple[RunRecord, ...]:
    """Loads every run file, sorted by (tool, question, run number)."""
    root = results_dir / "runs"
    try:
        log.info("Loading runs...", results_dir=str(results_dir))
        records = tuple(
            sorted(
                (_load(path) for path in _all_run_files(root)),
                key=lambda r: (r.tool, r.question_id, r.run),
            )
        )
    except RunStoreError:
        log.exception("Loading runs failed.", results_dir=str(results_dir))
        raise
    else:
        log.info("Loading runs succeeded.", runs=len(records))
        return records


def _all_run_files(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return [
        path
        for question_dir in root.glob("*/*")
        if question_dir.is_dir()
        for _, path in _run_files(question_dir)
    ]


def _run_files(directory: Path) -> list[tuple[int, Path]]:
    if not directory.is_dir():
        return []
    found = []
    for path in directory.iterdir():
        match = _RUN_FILE.fullmatch(path.name)
        if match and path.is_file():
            found.append((int(match.group(1)), path))
    return found


def _load(path: Path) -> RunRecord:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise RunStoreError(f"cannot read run file {path}: {err}") from err
    if not isinstance(data, dict):
        raise RunStoreError(f"{path} does not hold a JSON object")
    try:
        return record_from_json(data)
    except RunStoreError as err:
        raise RunStoreError(f"{path}: {err}") from err
