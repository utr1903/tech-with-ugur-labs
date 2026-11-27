"""The `run` command: one matrix cell, measured and recorded."""

from __future__ import annotations

import shutil
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.cells.collect import (
    collect_children,
    collect_skill_calls,
    collect_tools,
    model_of,
)
from app.cells.learning import Env, learn, wait_after
from app.cells.record import CellRecord, next_run_dir, write_record
from app.cells.skills import loaded_and_patched, skill_texts
from app.cells.stream import stream_to_file
from app.envvars import Settings
from app.errors import ConfigError
from app.hermes.client import HermesApi
from app.hermes.home import agent_created, copy_out, load_baseline, snapshot_path
from app.hermes.models import SessionRow
from app.hermes.prompt import triage_prompt
from app.hermes.review import ReviewOutcome, wait_for_review
from app.logging_setup import Logger
from app.output import write_line
from app.scoring.score import score_report

CELLS = (
    "full-cold",
    "full-warm",
    "full-control",
    "flat-cold",
    "flat-warm",
    "flat-control",
)


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


def _child_dict(row: SessionRow) -> dict[str, object]:
    return {
        "id": row.id,
        "input_tokens": row.input_tokens,
        "output_tokens": row.output_tokens,
        "tool_call_count": row.tool_call_count,
    }


def _sum(rows: list[SessionRow]) -> dict[str, int]:
    return {
        "input": sum(r.input_tokens for r in rows),
        "output": sum(r.output_tokens for r in rows),
    }


def _run_dir(cell_dir: Path, label: str | None) -> Path:
    if label is None:
        return next_run_dir(cell_dir)
    if (cell_dir / label).exists():
        raise ConfigError(f"Run folder {cell_dir / label} already exists")
    return cell_dir / label


def run(
    settings: Settings,
    args: RunArgs,
    *,
    client: HermesApi,
    log: Logger,
    wait: Callable[..., ReviewOutcome] = wait_for_review,
) -> CellRecord:
    """Runs one cell against Hermes and writes its `run.json`."""
    if args.cell not in CELLS:
        raise ConfigError(f"Unknown cell {args.cell}")
    run_dir = _run_dir(settings.results_dir / args.cell, args.repeat_label)
    run_dir.mkdir(parents=True)
    report = settings.out_dir / args.cell / "report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.unlink(missing_ok=True)

    home = settings.hermes_home
    baseline = load_baseline(snapshot_path(settings.results_dir, args.home), log=log)
    env = Env(client, home, baseline, run_dir, log, wait)
    before = skill_texts(home, baseline, log=log)
    version = str(client.health().get("version", ""))

    started = datetime.now(UTC)
    run_id = client.start_run(triage_prompt(args.week, args.cell))
    main = stream_to_file(client, run_id, run_dir / "events.jsonl", log=log)
    children = collect_children(client, run_id)
    review = wait_after(env, main, run_id, started)
    learning = learn(
        env,
        cell=args.cell,
        session_id=run_id,
        main=main,
        children=children,
        follow_up_if_no_skill=args.follow_up_if_no_skill,
    )
    all_children = children + learning.children
    parent_tools = Counter(main.tools)

    created = sorted(agent_created(home, baseline, log=log))
    after = skill_texts(home, baseline, log=log)
    ids = [run_id, *(c.id for c in all_children)]
    loaded, patched = loaded_and_patched(
        before, after, collect_skill_calls(client, ids)
    )
    child_tools = collect_tools(client, all_children)
    error = main.error
    if report.is_file():
        shutil.copyfile(report, run_dir / "report.json")
    elif error is None:
        error = "report.json was not written"
    score = score_report(
        run_dir / "report.json",
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
        run_id=run_id,
        session_id=run_id,
        started_at=started.isoformat(),
        wall_seconds=main.wall_seconds,
        status=main.status,
        error=error,
        score=score.to_dict(),
        parent_tokens={"input": main.input_tokens, "output": main.output_tokens},
        children=[_child_dict(c) for c in all_children],
        children_tokens=_sum(all_children),
        tools=dict(parent_tools + child_tools),
        parent_tools=dict(parent_tools),
        children_tools=dict(child_tools),
        skills_before=sorted(before),
        skills_after=sorted(after),
        agent_created_skills=created,
        skill_loaded=loaded,
        skill_patched=patched,
        learning_path=learning.path,
        review=_review(review),
        review_result=review.result if review else "n/a",
        follow_up=learning.follow_up,
        follow_up_review=_review(learning.follow_up_review),
        model=model_of(client, run_id),
        hermes_version=version,
    )
    write_record(run_dir, record)
    _summary(record, log)
    return record


def _summary(record: CellRecord, log: Logger) -> None:
    if record.error:
        log.error("Cell finished with an error.", cell=record.cell, error=record.error)
    write_line(
        f"{record.cell} {record.repeat}: status={record.status} "
        f"f1={record.score['f1']} wall={record.wall_seconds}s "
        f"learning={record.learning_path}"
    )
