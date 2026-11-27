"""Finds credential material in result files without ever echoing it."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from app.errors import LeakError

MAX_BYTES = 50 * 1024 * 1024
MIN_SECRET_LENGTH = 12
MIN_KEY_LINE_LENGTH = 40
SELF_REPORT = "leak-check.txt"
ADC_FIELDS = ("refresh_token", "client_secret", "private_key_id", "private_key")
ACCESS_TOKEN = re.compile(r"ya29\.[0-9A-Za-z_\-]{20,}")


@dataclass(frozen=True)
class LeakHit:
    """One file holding one kind of credential; never the value itself."""

    path: Path
    kind: str


def secrets_from_adc(adc: Path) -> tuple[str, ...]:
    """Returns the secret values of a gcloud ADC file, long enough to match."""
    try:
        data = json.loads(adc.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise LeakError(f"Cannot read the ADC file at {adc}") from exc
    if not isinstance(data, dict):
        raise LeakError(f"The ADC file at {adc} is not a JSON object")
    secrets: list[str] = []
    for field in ADC_FIELDS:
        value = data.get(field)
        if not isinstance(value, str) or len(value) < MIN_SECRET_LENGTH:
            continue
        secrets.append(value)
        if field == "private_key":
            secrets.extend(
                line
                for line in value.splitlines()
                if len(line) >= MIN_KEY_LINE_LENGTH and not line.startswith("-----")
            )
    return tuple(secrets)


def scan(root: Path, secrets: Sequence[str], *, api_key: str = "") -> list[LeakHit]:
    """Scans every regular file under `root`, skipping symlinks."""
    hits: list[LeakHit] = []
    if not root.is_dir():
        return hits
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if path.is_symlink() or not path.is_file() or str(relative) == SELF_REPORT:
            continue
        if path.stat().st_size > MAX_BYTES:
            raise LeakError(f"{relative} is too large to scan")
        text = path.read_bytes().decode("utf-8", errors="replace")
        hits.extend(LeakHit(relative, kind) for kind in _kinds(text, secrets, api_key))
    return hits


def _kinds(text: str, secrets: Sequence[str], api_key: str) -> list[str]:
    kinds = []
    if any(secret in text for secret in secrets):
        kinds.append("adc-secret")
    if ACCESS_TOKEN.search(text):
        kinds.append("access-token")
    if api_key and api_key in text:
        kinds.append("api-server-key")
    return kinds
