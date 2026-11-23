"""The behaviour demo cases and how their outcomes are read."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.events.model import Event


@dataclass(frozen=True)
class Case:
    """One demo case: a script to run and the policy event it should (not) raise."""

    name: str
    case: str
    policy_file: str
    policy: str
    script_namespace: str
    script_pod: str
    script: str
    watch_pod: str
    alert_function: str
    expected_alert: bool
    mode: str


_LINEAGE = ("lineage.yaml", "demo-lineage", "monitor_only")
_STATEFUL = ("stateful-exfil.yaml", "demo-stateful-exfil", "monitor_only")
_SIGKILL = ("delete-sigkill.yaml", "demo-delete-sigkill", "enforce")
_OVERRIDE = ("delete-override.yaml", "demo-delete-override", "enforce")

CASES: tuple[Case, ...] = (
    Case(
        "lineage",
        "rce",
        *_LINEAGE[:2],
        "attacker",
        "attacker",
        "lineage-rce.sh",
        "webapp",
        "execve",
        True,
        _LINEAGE[2],
    ),
    Case(
        "lineage",
        "admin",
        *_LINEAGE[:2],
        "victim",
        "webapp",
        "lineage-admin.sh",
        "webapp",
        "execve",
        False,
        _LINEAGE[2],
    ),
    Case(
        "stateful",
        "connect-only",
        *_STATEFUL[:2],
        "victim",
        "victim",
        "stateful-connect.sh",
        "victim",
        "tcp_connect",
        False,
        _STATEFUL[2],
    ),
    Case(
        "stateful",
        "read-only",
        *_STATEFUL[:2],
        "victim",
        "victim",
        "stateful-read.sh",
        "victim",
        "tcp_connect",
        False,
        _STATEFUL[2],
    ),
    Case(
        "stateful",
        "read-then-connect",
        *_STATEFUL[:2],
        "victim",
        "victim",
        "stateful-read-connect.sh",
        "victim",
        "tcp_connect",
        True,
        _STATEFUL[2],
    ),
    Case(
        "sigkill-vs-override",
        "sigkill",
        *_SIGKILL[:2],
        "victim",
        "victim",
        "delete-run.sh",
        "victim",
        "unlinkat",
        True,
        _SIGKILL[2],
    ),
    Case(
        "sigkill-vs-override",
        "override",
        *_OVERRIDE[:2],
        "victim",
        "victim",
        "delete-run.sh",
        "victim",
        "unlinkat",
        True,
        _OVERRIDE[2],
    ),
)

SIGKILL_RC = 137


def is_alert(event: Event, case: Case) -> bool:
    """True for a kprobe event of the case's policy and function in its pod."""
    return (
        event.kind == "kprobe"
        and event.policy == case.policy
        and event.pod == case.watch_pod
        and case.alert_function in (event.function or "")
    )


def delete_outcome(case: str, stdout: str) -> tuple[bool, str]:
    """Whether rm and the file ended up as the case's policy action implies."""
    rc_match = re.search(r"^RM_RC=(\d+)$", stdout, re.MULTILINE)
    file_match = re.search(r"^FILE=(present|gone)$", stdout, re.MULTILINE)
    if rc_match is None or file_match is None:
        return False, "rm result missing from script output"
    rc, present = int(rc_match.group(1)), file_match.group(1) == "present"
    detail = f"rm rc {rc}, file {'remains' if present else 'gone'}"
    if case == "sigkill":
        return rc == SIGKILL_RC and not present, detail
    return rc != 0 and rc != SIGKILL_RC and present, detail
