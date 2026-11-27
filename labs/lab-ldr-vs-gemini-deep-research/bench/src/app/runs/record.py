"""One research run as a value, and its JSON payload form."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from app.errors import RunStoreError


@dataclass(frozen=True)
class RunRecord:
    """Everything one tool produced for one question in one run.

    `tool` is `ldr` or `gemini`; `status` is `completed`, `failed` or `timeout`.
    """

    tool: str
    question_id: str
    run: int
    started_at: str
    wall_seconds: float
    status: str
    report: str
    sources: tuple[str, ...]
    usage: Mapping[str, object]
    cost_usd: float | None
    meta: Mapping[str, object]


def record_to_json(record: RunRecord) -> dict[str, object]:
    """Converts a run record to its file payload."""
    return {
        "tool": record.tool,
        "question_id": record.question_id,
        "run": record.run,
        "started_at": record.started_at,
        "wall_seconds": record.wall_seconds,
        "status": record.status,
        "report": record.report,
        "sources": list(record.sources),
        "usage": dict(record.usage),
        "cost_usd": record.cost_usd,
        "meta": dict(record.meta),
    }


def record_from_json(data: Mapping[str, object]) -> RunRecord:
    """Rebuilds a run record; raises `RunStoreError` on a missing or bad field."""
    try:
        cost = data["cost_usd"]
        return RunRecord(
            tool=str(data["tool"]),
            question_id=str(data["question_id"]),
            run=int(str(data["run"])),
            started_at=str(data["started_at"]),
            wall_seconds=float(str(data["wall_seconds"])),
            status=str(data["status"]),
            report=str(data["report"]),
            sources=tuple(str(s) for s in _sequence(data["sources"])),
            usage=_mapping(data["usage"]),
            cost_usd=None if cost is None else float(str(cost)),
            meta=_mapping(data["meta"]),
        )
    except KeyError as err:
        raise RunStoreError(f"run record is missing key {err}") from err
    except (TypeError, ValueError) as err:
        raise RunStoreError(f"run record has a malformed field: {err}") from err


def _sequence(value: object) -> list[object]:
    if not isinstance(value, list):
        raise TypeError("expected a list")
    return value


def _mapping(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise TypeError("expected an object")
    return {str(k): v for k, v in value.items()}
