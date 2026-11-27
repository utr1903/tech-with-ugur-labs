"""The Hermes-facing part of a cell: prompt, stream, collect, learn."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.cells.collect import (
    collect_children,
    collect_skill_calls,
    collect_tools,
    model_of,
)
from app.cells.learning import Env, Learning, learn, wait_after
from app.cells.stream import StreamOutcome, stream_to_file
from app.hermes.models import SessionRow
from app.hermes.prompt import triage_prompt
from app.hermes.review import ReviewOutcome


@dataclass
class Measured:
    """What was observed; fields fill in as far as Hermes cooperated."""

    started: datetime = field(default_factory=lambda: datetime.now(UTC))
    version: str = ""
    run_id: str = ""
    main: StreamOutcome = field(
        default_factory=lambda: StreamOutcome("error", None, 0, 0, Counter(), 0.0)
    )
    children: list[SessionRow] = field(default_factory=list)
    child_tools: Counter[str] = field(default_factory=Counter)
    review: ReviewOutcome | None = None
    learning: Learning = field(default_factory=Learning)
    skill_calls: list[tuple[str, str, str]] = field(default_factory=list)
    model: str = ""


def measure(
    env: Env,
    m: Measured,
    *,
    cell: str,
    week: str,
    before: frozenset[str],
    follow_up_if_no_skill: bool,
) -> None:
    """Runs the cell's turns; raises HermesError, leaving `m` partly filled."""
    m.version = str(env.client.health().get("version", ""))
    m.started = datetime.now(UTC)
    m.run_id = env.client.start_run(triage_prompt(week, cell))
    m.main = stream_to_file(
        env.client, m.run_id, env.run_dir / "events.jsonl", log=env.log
    )
    m.children = collect_children(env.client, m.run_id)
    m.child_tools = collect_tools(env.client, m.children)
    m.review = wait_after(env, m.main, m.run_id, m.started)
    m.learning = learn(
        env,
        cell=cell,
        session_id=m.run_id,
        main=m.main,
        children=m.children,
        before=before,
        follow_up_if_no_skill=follow_up_if_no_skill,
    )
    ids = [m.run_id, *(c.id for c in [*m.children, *m.learning.follow_up_children])]
    m.skill_calls = collect_skill_calls(env.client, ids)
    m.model = model_of(env.client, m.run_id)
