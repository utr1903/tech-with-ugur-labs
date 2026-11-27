"""The `assert-e2e` command: the lab's end-to-end pass/fail gate."""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path

from app.cells.record import CellRecord
from app.commands.run import CELLS
from app.envvars import Settings
from app.errors import LabError, ReportError
from app.hermes.home import parse_frontmatter
from app.logging_setup import Logger
from app.metrics.aggregate import latest, load_records, runs_root
from app.metrics.numbers import num
from app.output import write_line

HERMES_VERSION = "0.23.4"
CURATOR_HOMES = ("full-learn", "flat-learn")
type Check = tuple[bool, str]
type Latest = dict[str, CellRecord]


def _exit_code(path: Path) -> int | None:
    if not path.is_file():
        return None
    match = re.search(r"^exit=(\d+)\s*$", path.read_text(encoding="utf-8"), re.M)
    return int(match[1]) if match else None


def _exit_check(path: Path, label: str) -> Check:
    code = _exit_code(path)
    return code == 0, f"{label} exit={'missing' if code is None else code}"


def _versions(rows: Latest, model: str) -> Check:
    bad = [
        c
        for c, r in rows.items()
        if r.hermes_version != HERMES_VERSION or r.model != model
    ]
    return not bad and bool(
        rows
    ), f"hermes {HERMES_VERSION} and model {model} on every cell (bad: {bad})"


def _complete(rows: Latest) -> Check:
    bad = [
        c
        for c in CELLS
        if c not in rows
        or rows[c].status != "completed"
        or rows[c].score.get("format_failure") is not False
    ]
    return not bad, f"all six cells completed with a valid report (bad: {bad})"


def _f1(rows: Latest, threshold: float) -> Check:
    full = {c: num(r.score.get("f1")) for c, r in rows.items() if c.startswith("full-")}
    flat = {c: num(r.score.get("f1")) for c, r in rows.items() if c.startswith("flat-")}
    write_line(f"INFO flat F1 (not asserted): {flat}")
    bad = [c for c in CELLS if c.startswith("full-") and full.get(c, -1.0) < threshold]
    return not bad, f"full-* F1 >= {threshold} (below: {bad})"


def _skill_text_ok(run_dir: Path, rec: CellRecord) -> bool:
    for name in rec.skills_after:
        path = run_dir / "skills" / name / "SKILL.md"
        try:
            parse_frontmatter(path.read_text(encoding="utf-8"))
        except (OSError, ReportError):
            return False
    return bool(rec.skills_after)


def _learning(rows: Latest, root: Path) -> Check:
    cold, warm, ctrl = (
        rows.get("full-cold"),
        rows.get("full-warm"),
        rows.get("full-control"),
    )
    if not (cold and warm and ctrl):
        return False, "learning evidence (a full-* cell is missing)"
    ok = (
        _skill_text_ok(root / cold.cell / cold.repeat, cold)
        and warm.skill_loaded
        and not ctrl.skills_before
    )
    return (
        ok,
        "full-cold wrote a valid skill, full-warm loaded it, full-control empty",
    )


def _tools(rows: Latest) -> Check:
    bad = []
    for cell, rec in rows.items():
        delegate = rec.tools.get("delegate_task", 0)
        execute = rec.tools.get("execute_code", 0)
        used = delegate >= 1 and execute >= 1
        unused = delegate == 0 and execute == 0
        if not (used if cell.startswith("full-") else unused):
            bad.append(cell)
    return not bad, f"full-* delegate and execute code, flat-* neither (bad: {bad})"


def _curator(results: Path) -> Check:
    codes = results / "curator" / "exit-codes.txt"
    text = codes.read_text(encoding="utf-8") if codes.is_file() else ""
    ok = all(
        re.search(rf"^{home} dry-run=0 status=\d+\s*$", text, re.M)
        and (results / "curator" / f"{home}-status.txt").is_file()
        for home in CURATOR_HOMES
    )
    return ok, "curator dry-runs exited 0 and status files exist"


def _metrics(results: Path) -> Check:
    path = results / "metrics.md"
    text = path.read_text(encoding="utf-8") if path.is_file() else ""
    missing = [c for c in CELLS if f"| {c} |" not in text]
    return not missing, f"metrics.md has the six cell rows (missing: {missing})"


def run(settings: Settings, *, f1_threshold: float = 0.8, log: Logger) -> None:
    """Prints one PASS or FAIL line per assertion; raises if any failed."""
    results = settings.results_dir
    records = load_records(results)
    rows = {c: r for c in CELLS if (r := latest(records, c))}
    root = runs_root(results)
    checks: list[Callable[[], Check]] = [
        lambda: _exit_check(results / "fixtures-check.txt", "fixtures-check"),
        lambda: _versions(rows, settings.hermes_model),
        lambda: _complete(rows),
        lambda: _f1(rows, f1_threshold),
        lambda: _learning(rows, root),
        lambda: _tools(rows),
        lambda: _both(_metrics(results), _curator(results)),
        lambda: _exit_check(results / "leak-check.txt", "leak-check"),
    ]
    failed = 0
    for number, check in enumerate(checks, 1):
        ok, text = check()
        write_line(f"{'PASS' if ok else 'FAIL'} {number} {text}")
        failed += not ok
    log.info("End-to-end assertions finished.", failed=failed)
    if failed:
        raise LabError(f"{failed} end-to-end assertions failed")


def _both(first: Check, second: Check) -> Check:
    return first[0] and second[0], f"{first[1]}; {second[1]}"
