"""The learning path of a cold cell: unprompted skill or a follow-up nudge."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from app.cells.collect import (
    child_dicts,
    collect_children,
    collect_tools,
    sum_tokens,
)
from app.cells.stream import COMPLETED, StreamOutcome, stream_to_file
from app.errors import HermesError
from app.hermes.client import HermesApi
from app.hermes.home import agent_created
from app.hermes.models import SessionRow
from app.hermes.prompt import FOLLOW_UP
from app.hermes.review import ReviewOutcome, wait_for_review
from app.logging_setup import Logger


class Wait(Protocol):
    """The shape of `wait_for_review`; tests substitute a fake."""

    def __call__(
        self, agent_log: Path, session_id: str, *, started_after: datetime, log: Logger
    ) -> ReviewOutcome: ...


@dataclass(frozen=True)
class Learning:
    """The learning path and the self-contained follow-up turn, if any."""

    path: str = "n/a"
    follow_up: dict[str, object] | None = None
    follow_up_review: ReviewOutcome | None = None
    follow_up_children: tuple[SessionRow, ...] = ()


@dataclass(frozen=True)
class Env:
    """The pieces every step of a cell needs."""

    client: HermesApi
    home: Path
    baseline: frozenset[str]
    run_dir: Path
    log: Logger
    wait: Wait = wait_for_review

    @property
    def agent_log(self) -> Path:
        return self.home / "logs" / "agent.log"

    def created(self) -> set[str]:
        return set(agent_created(self.home, self.baseline, log=self.log))


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
    before: frozenset[str],
    follow_up_if_no_skill: bool,
) -> Learning:
    """Decides the learning path; runs the follow-up turn when asked."""
    if not cell.endswith("-cold"):
        return Learning()
    if env.created() - before:
        return Learning(path="unprompted")
    if not (follow_up_if_no_skill and main.status == COMPLETED):
        return Learning(path="none")
    info, review, extra = _follow_up(env, session_id, {c.id for c in children})
    made = bool(env.created() - before) and info["status"] == COMPLETED
    return Learning("follow-up" if made else "none", info, review, tuple(extra))


def _follow_up(
    env: Env, session_id: str, known: set[str]
) -> tuple[dict[str, object], ReviewOutcome | None, list[SessionRow]]:
    info: dict[str, object] = {"run_id": "", "status": "error", "error": None}
    review: ReviewOutcome | None = None
    extra: list[SessionRow] = []
    try:
        started = datetime.now(UTC)
        info["run_id"] = env.client.start_run(FOLLOW_UP, session_id=session_id)
        out = stream_to_file(
            env.client,
            str(info["run_id"]),
            env.run_dir / "follow_up_events.jsonl",
            log=env.log,
        )
        extra = collect_children(env.client, session_id, known=frozenset(known))
        child_tools = collect_tools(env.client, extra)
        review = wait_after(env, out, session_id, started)
    except HermesError as err:
        env.log.exception("Follow-up failed.", session_id=session_id)
        info.update(error=str(err))
        return info, review, extra
    info.update(
        status=out.status,
        error=out.error,
        input_tokens=out.input_tokens,
        output_tokens=out.output_tokens,
        parent_tools=dict(out.tools),
        children=child_dicts(extra),
        children_tokens=sum_tokens(extra),
        children_tools=dict(child_tools),
        tools=dict(Counter(out.tools) + child_tools),
    )
    return info, review, extra
