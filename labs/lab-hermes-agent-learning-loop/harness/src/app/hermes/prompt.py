"""The fixed triage prompt and follow-up. No mention of skills in the prompt."""

from __future__ import annotations

TODAY = "2026-11-27"

FOLLOW_UP = (
    "Save the workflow you just used for this weekly triage as a reusable "
    "skill so you can do it faster next week."
)

_TOOL_HINT = (
    "If you have delegate_task, give each service to its own subagent: call "
    "delegate_task once with tasks set to a list of objects, one per service, "
    'each with a "goal" and a "context" string. '
    "If you have execute_code, do counting and matching in code instead of "
    "reading whole files into the conversation."
)


def triage_prompt(week: str, cell: str) -> str:
    """Returns the identical-per-cell instruction for one week's triage."""
    return "\n".join(
        [
            f"Today's date is {TODAY}.",
            f"Run the weekly security triage of the fleet in /fleet/{week}. "
            f"Follow /fleet/{week}/RUNBOOK.md exactly.",
            "Write the result as plain JSON (no markdown fence) to "
            f"/out/{cell}/report.json in the schema from the runbook, then "
            "reply with one line saying where you wrote it.",
            _TOOL_HINT,
        ]
    )
