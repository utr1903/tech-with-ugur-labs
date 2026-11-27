"""The `run` command: one matrix cell, measured and recorded."""

from __future__ import annotations

import re
import shutil
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

from app.cells.collect import child_dicts, sum_tokens
from app.cells.learning import Env, Wait
from app.cells.measure import Measured, measure
from app.cells.names import CELLS
from app.cells.record import CellRecord, next_run_dir, write_record
from app.cells.skills import skill_changes, skill_texts
from app.envvars import Settings
from app.errors import ConfigError, HermesError
from app.hermes.client import HermesApi
from app.hermes.home import agent_created, copy_out, load_baseline, snapshot_path
from app.hermes.review import ReviewOutcome, wait_for_review
from app.logging_setup import Logger
from app.output import write_line
from app.scoring.score import score_report


@dataclass(frozen=True)
class RunArgs:
    """Command-line choices for one cell."""

    cell: str
    week: str
    home: str
    follow_up_if_no_skill: bool = False
    repeat_label: str | None = None


def _review(outcome: ReviewOutcome | None) -> dict[str, object] | None:
    return None if outcome is None else asdict(outcome)


def _run_dir(cell_dir: Path, label: str | None) -> Path:
    if label is None:
        return next_run_dir(cell_dir)
    if not re.fullmatch(r"r\d+", label):
        raise ConfigError(f"repeat label {label!r} is not of the form rN")
    if (cell_dir / label).exists():
        raise ConfigError(f"Run folder {cell_dir / label} already exists")
    return cell_dir / label


def empty_out(out_dir: Path, *, log: Logger) -> None:
    """Deletes everything under `out_dir`, so no cell sees another's report."""
    try:
        log.info("Emptying output folder...", out_dir=str(out_dir))
        out_dir.mkdir(parents=True, exist_ok=True)
        entries = list(out_dir.iterdir())
        for entry in entries:
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
            else:
                entry.unlink()
    except OSError:
        log.exception("Emptying output folder failed.", out_dir=str(out_dir))
        raise
    else:
        log.info("Emptying output folder succeeded.", removed=len(entries))


def run(
    settings: Settings,
    args: RunArgs,
    *,
    client: HermesApi,
    log: Logger,
    wait: Wait = wait_for_review,
) -> CellRecord:
    """Runs one cell against Hermes and writes its `run.json`.

    The run folder is only created once the cell starts; if the cell fails
    in an unexpected way it is removed again, so no empty `rN` is left.
    """
    if args.cell not in CELLS:
        raise ConfigError(f"Unknown cell {args.cell}")
    run_dir = _run_dir(settings.results_dir / "runs" / args.cell, args.repeat_label)
    baseline = load_baseline(snapshot_path(settings.results_dir, args.home), log=log)
    empty_out(settings.out_dir, log=log)
    (settings.out_dir / args.cell).mkdir()
    run_dir.mkdir(parents=True)
    env = Env(client, settings.hermes_home, baseline, run_dir, log, wait)
    try:
        record = _run_cell(settings, args, env)
    except Exception:
        log.exception("Running cell failed.", cell=args.cell, run_dir=str(run_dir))
        shutil.rmtree(run_dir, ignore_errors=True)
        raise
    _summary(record, log)
    return record


def _run_cell(settings: Settings, args: RunArgs, env: Env) -> CellRecord:
    home, baseline, run_dir, log = env.home, env.baseline, env.run_dir, env.log
    report = settings.out_dir / args.cell / "report.json"
    copied = run_dir / "report.json"

    def keep_main_report() -> None:
        if report.is_file():
            shutil.copyfile(report, copied)

    before = skill_texts(home, baseline, log=log)
    m = Measured()
    failure: str | None = None
    try:
        measure(
            env,
            m,
            cell=args.cell,
            week=args.week,
            before=frozenset(before),
            follow_up_if_no_skill=args.follow_up_if_no_skill,
            after_main=keep_main_report,
        )
    except HermesError as err:
        failure = str(err)
        log.exception("Hermes failed during the cell.", cell=args.cell)
    main = m.main
    parent_tools = Counter(main.tools)
    created = sorted(agent_created(home, baseline, log=log))
    after = skill_texts(home, baseline, log=log)
    changes = skill_changes(before, after, m.skill_calls)
    follow_error = (m.learning.follow_up or {}).get("error")
    errors = [
        e
        for e in (
            failure or main.error,
            f"follow-up: {follow_error}" if follow_error else None,
        )
        if e
    ]
    if not copied.is_file() and not errors:
        errors.append("report.json was not written")
    score = score_report(
        copied,
        settings.data_dir / "answers" / f"{args.week}.json",
        log=log,
    )
    if created or (home / "memories" / "MEMORY.md").is_file():
        copy_out(home, created, run_dir, log=log)

    record = CellRecord(
        cell=args.cell,
        config=args.cell.split("-")[0],
        home=args.home,
        week=args.week,
        repeat=run_dir.name,
        run_id=m.run_id,
        session_id=m.run_id,
        started_at=m.started.isoformat(),
        wall_seconds=main.wall_seconds,
        status="error" if failure else main.status,
        error="; ".join(errors) or None,
        score=score.to_dict(),
        parent_tokens={"input": main.input_tokens, "output": main.output_tokens},
        children=child_dicts(m.children),
        children_tokens=sum_tokens(m.children),
        tools=dict(parent_tools + m.child_tools),
        parent_tools=dict(parent_tools),
        children_tools=dict(m.child_tools),
        skills_before=sorted(before),
        skills_after=sorted(after),
        skills_deleted=changes.deleted,
        agent_created_skills=created,
        skill_loaded=changes.loaded,
        skill_patched=changes.patched,
        learning_path=m.learning.path,
        review=_review(m.review),
        review_result=m.review.result if m.review else "n/a",
        follow_up=m.learning.follow_up,
        follow_up_review=_review(m.learning.follow_up_review),
        model=m.model,
        hermes_version=m.version,
    )
    write_record(run_dir, record)
    return record


def _summary(record: CellRecord, log: Logger) -> None:
    if record.error:
        log.error("Cell finished with an error.", cell=record.cell, error=record.error)
    write_line(
        f"{record.cell} {record.repeat}: status={record.status} "
        f"f1={record.score['f1']} wall={record.wall_seconds}s "
        f"learning={record.learning_path}"
        + (f" follow_up={record.follow_up['status']}" if record.follow_up else "")
    )
