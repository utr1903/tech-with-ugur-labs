"""The learning path of a cold cell: unprompted skill or a follow-up nudge."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.cells.collect import collect_children
from app.cells.stream import COMPLETED, StreamOutcome, stream_to_file
from app.hermes.client import HermesApi
from app.hermes.home import agent_created
from app.hermes.models import SessionRow
from app.hermes.prompt import FOLLOW_UP
from app.hermes.review import ReviewOutcome, wait_for_review
from app.logging_setup import Logger


@dataclass(frozen=True)
class Learning:
    """What the learning path found and what the follow-up cost."""

    path: str = "n/a"
    follow_up: dict[str, object] | None = None
    follow_up_review: ReviewOutcome | None = None
    children: list[SessionRow] = field(default_factory=list)


@dataclass(frozen=True)
class Env:
    """The pieces every step of a cell needs."""

    client: HermesApi
    home: Path
    baseline: frozenset[str]
    run_dir: Path
    log: Logger
    wait: Callable[..., ReviewOutcome] = wait_for_review

    @property
    def agent_log(self) -> Path:
        return self.home / "logs" / "agent.log"

    def created(self) -> dict[str, object]:
        return dict(agent_created(self.home, self.baseline, log=self.log))


def wait_after(
    env: Env, outcome: StreamOutcome, session_id: str, started: datetime
) -> ReviewOutcome | None:
    """Waits for the background review of a completed turn."""
    if outcome.status != COMPLETED:
        return None
    return env.wait(env.agent_log, session_id, started_after=started, log=env.log)


def learn(
    env: Env,
    *,
    cell: str,
    session_id: str,
    main: StreamOutcome,
    children: list[SessionRow],
    follow_up_if_no_skill: bool,
) -> Learning:
    """Decides the learning path; runs the follow-up turn when asked."""
    if not cell.endswith("-cold"):
        return Learning()
    if env.created():
        return Learning(path="unprompted")
    if not (follow_up_if_no_skill and main.status == COMPLETED):
        return Learning(path="none")
    started = datetime.now(UTC)
    follow_id = env.client.start_run(FOLLOW_UP, session_id=session_id)
    out = stream_to_file(
        env.client, follow_id, env.run_dir / "follow_up_events.jsonl", log=env.log
    )
    extra = collect_children(
        env.client, session_id, known=frozenset(c.id for c in children)
    )
    review = wait_after(env, out, session_id, started)
    info: dict[str, object] = {
        "run_id": follow_id,
        "input_tokens": out.input_tokens,
        "output_tokens": out.output_tokens,
        "status": out.status,
        "tools": dict(out.tools),
    }
    return Learning("follow-up" if env.created() else "none", info, review, extra)
