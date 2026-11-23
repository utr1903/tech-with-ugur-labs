"""The `tetra` CLI inside the Tetragon pod, and parsers for its output."""

from __future__ import annotations

import re
from collections.abc import Sequence

from app.kube.kubectl import kubectl
from app.logging_setup import Logger

_OVERRIDE = re.compile(r"^override_return:\s*true\s*$", re.MULTILINE)
_COLUMNS = ("NAME", "STATE", "MODE")


def tetra(args: Sequence[str], *, log: Logger) -> str:
    """Runs `tetra <args>` in the Tetragon container and returns stdout."""
    return kubectl(
        ["-n", "kube-system", "exec", "ds/tetragon", "-c", "tetragon", "--", "tetra"]
        + list(args),
        log=log,
    ).stdout


def probe_has_override(text: str) -> bool:
    """True when `tetra probe` output reports `override_return: true`."""
    return _OVERRIDE.search(text) is not None


def override_available(*, log: Logger) -> bool:
    """Whether the node kernel supports the Override action."""
    try:
        log.info("Probing override support...")
        available = probe_has_override(tetra(["probe"], log=log))
    except Exception:
        log.exception("Probing override support failed.")
        raise
    else:
        log.info("Probing override support succeeded.", override=available)
        return available


def _starts(header: str) -> dict[str, int]:
    return {m.group(0): m.start() for m in re.finditer(r"\S+", header)}


def _cell(line: str, starts: dict[str, int], name: str) -> str:
    ordered = sorted(starts.values())
    begin = starts[name]
    later = [s for s in ordered if s > begin]
    return line[begin : later[0] if later else None].strip()


def parse_policy_list(text: str) -> dict[str, tuple[str, str]]:
    """Maps policy name to (state, mode) from `tetra tracingpolicy list`.

    Columns are cut by the header's offsets because KERNELMEMORY holds
    values with a space ("1.04 MB"). Unknown layouts yield an empty map.
    """
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return {}
    starts = _starts(lines[0])
    if not all(column in starts for column in _COLUMNS):
        return {}
    return {
        _cell(line, starts, "NAME"): (
            _cell(line, starts, "STATE"),
            _cell(line, starts, "MODE"),
        )
        for line in lines[1:]
    }
