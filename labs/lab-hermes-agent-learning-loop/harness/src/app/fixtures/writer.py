"""Writes the generated fleet and answer keys to disk, or checks them."""

from __future__ import annotations

import json
from pathlib import Path, PurePosixPath

from app.errors import FixtureError
from app.fixtures.generator import WEEKS, generate_week
from app.fixtures.plan import plan_week
from app.fixtures.rules import WeekAnswer, answers_for_week
from app.logging_setup import Logger


def render_answer(answer: WeekAnswer) -> bytes:
    """The answer-key file for one week."""
    document = json.dumps(answer.to_report_dict(), indent=2, sort_keys=True)
    return (document + "\n").encode()


def _expected_files() -> dict[PurePosixPath, bytes]:
    expected: dict[PurePosixPath, bytes] = {}
    for week in WEEKS:
        for relative, content in generate_week(week).items():
            expected[PurePosixPath("fleet") / week / relative] = content
        expected[PurePosixPath("answers") / f"{week}.json"] = render_answer(
            plan_week(week).answer()
        )
    return expected


def _write_fleet(data_dir: Path) -> int:
    count = 0
    for week in WEEKS:
        for relative, content in generate_week(week).items():
            target = data_dir / "fleet" / week / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            count += 1
    return count


def _write_answers(data_dir: Path) -> int:
    (data_dir / "answers").mkdir(parents=True, exist_ok=True)
    for week in WEEKS:
        derived = answers_for_week(data_dir / "fleet" / week)
        if derived != plan_week(week).answer():
            raise FixtureError(f"derived answers for {week} differ from the plan")
        (data_dir / "answers" / f"{week}.json").write_bytes(render_answer(derived))
    return len(WEEKS)


def write_fixtures(data_dir: Path, *, log: Logger) -> int:
    """Writes fleet files and derives answer keys from them; returns the count."""
    try:
        log.info("Writing fixtures...", data_dir=str(data_dir))
        count = _write_fleet(data_dir) + _write_answers(data_dir)
    except (OSError, FixtureError):
        log.exception("Writing fixtures failed.", data_dir=str(data_dir))
        raise
    else:
        log.info("Writing fixtures succeeded.", files=count)
        return count


def _differences(data_dir: Path) -> list[str]:
    expected = _expected_files()
    found = {
        PurePosixPath(path.relative_to(data_dir).as_posix())
        for folder in ("fleet", "answers")
        for path in (data_dir / folder).rglob("*")
        if path.is_file()
    }
    differing = {
        path
        for path, content in expected.items()
        if not (data_dir / path).is_file() or (data_dir / path).read_bytes() != content
    }
    return sorted(str(path) for path in differing | (found - expected.keys()))


def check_fixtures(data_dir: Path, *, log: Logger) -> list[str]:
    """Returns the paths whose bytes differ from what the generator produces."""
    try:
        log.info("Checking fixtures...", data_dir=str(data_dir))
        differing = _differences(data_dir)
    except OSError:
        log.exception("Checking fixtures failed.", data_dir=str(data_dir))
        raise
    else:
        log.info("Checking fixtures succeeded.", differing=len(differing))
        return differing
