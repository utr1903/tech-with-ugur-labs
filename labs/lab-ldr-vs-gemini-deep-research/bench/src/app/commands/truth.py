"""The `truth` command: freeze the answer keys from the public feeds."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import httpx

from app.errors import ConfigError, TruthError
from app.logging_setup import Logger
from app.output import write_line
from app.truth.edgar import MSFT_QUARTER_ENDS, build_msft_truth
from app.truth.fetch import KEV_FEED_URL, MSFT_FACTS_URL, fetch_json
from app.truth.kev import KEV_WINDOW, build_kev_truth
from app.truth.store import (
    kev_truth_to_json,
    msft_truth_to_json,
    render_truth,
    write_truth,
)

KEV_FILE = "kev-2026-10.json"
MSFT_FILE = "msft-quarters.json"
_PLACEHOLDER_AGENT = "Your Name your.email@example.org"
_DEFAULT_DATA_DIR = "/work/data"


def run(args: argparse.Namespace, *, log: Logger) -> None:
    """Builds both answer keys and writes them, or with --check compares them."""
    user_agent = _user_agent()
    truth_dir = Path(os.environ.get("DATA_DIR", _DEFAULT_DATA_DIR)) / "truth"
    headers = {"User-Agent": user_agent}
    with httpx.Client(headers=headers, timeout=60, follow_redirects=True) as client:
        kev = build_kev_truth(
            fetch_json(client, KEV_FEED_URL, log=log),
            start=KEV_WINDOW[0],
            end=KEV_WINDOW[1],
        )
        msft = build_msft_truth(
            fetch_json(client, MSFT_FACTS_URL, log=log),
            quarter_ends=MSFT_QUARTER_ENDS,
        )
    keys = {
        KEV_FILE: kev_truth_to_json(kev),
        MSFT_FILE: msft_truth_to_json(msft),
    }

    if args.check:
        differing = [n for n, p in keys.items() if _differs(truth_dir / n, p)]
        for name in keys:
            write_line(f"{name}: {'DIFFERS' if name in differing else 'matches'}")
        if differing:
            raise TruthError(f"committed answer keys differ: {', '.join(differing)}")
    else:
        for name, payload in keys.items():
            changed = write_truth(truth_dir / name, payload, log=log)
            write_line(f"{name}: {'written' if changed else 'unchanged'}")

    write_line(f"KEV entries: {len(kev.entries)}")
    for quarter in msft.quarters:
        flag = " (derived)" if quarter.derived else ""
        write_line(f"{quarter.quarter_end}{flag}")


def _differs(path: Path, payload: dict[str, object]) -> bool:
    try:
        return path.read_text(encoding="utf-8") != render_truth(payload)
    except OSError:
        return True


def _user_agent() -> str:
    value = os.environ.get("SEC_USER_AGENT", "").strip()
    if not value or value == _PLACEHOLDER_AGENT:
        raise ConfigError(
            "SEC_USER_AGENT must be set to your own contact string "
            "(SEC and CISA reject anonymous clients)"
        )
    return value
