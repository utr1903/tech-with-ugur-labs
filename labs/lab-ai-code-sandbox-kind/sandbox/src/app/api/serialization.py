"""Wire form of an execution outcome."""

from __future__ import annotations

from app.execution.models import ExecutionOutcome


def outcome_to_json(outcome: ExecutionOutcome) -> dict[str, object]:
    """camelCase JSON matching the documented POST /execute response."""
    return {
        "status": outcome.status.value,
        "exitCode": outcome.exit_code,
        "stdout": outcome.stdout,
        "stderr": outcome.stderr,
        "result": outcome.result,
        "resultError": outcome.result_error,
        "durationMs": outcome.duration_ms,
        "truncated": outcome.truncated,
    }
