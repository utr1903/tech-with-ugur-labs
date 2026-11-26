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
    load_kev_truth,
    msft_truth_to_json,
    same_content,
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
        differing = [n for n, p in keys.items() if not _matches(truth_dir, n, p)]
        for name in keys:
            write_line(f"{name}: {'DIFFERS' if name in differing else 'matches'}")
        if differing:
            raise TruthError(f"committed answer keys differ: {', '.join(differing)}")
    else:
        for name, payload in keys.items():
            changed = write_truth(
                truth_dir / name, payload, log=log, ignore=_ignored(name)
            )
            write_line(f"{name}: {'written' if changed else 'unchanged'}")
    _note_catalog(truth_dir / KEV_FILE, kev.catalog_version)

    write_line(f"KEV entries: {len(kev.entries)}")
    for quarter in msft.quarters:
        flag = " (derived)" if quarter.derived else ""
        write_line(f"{quarter.quarter_end}{flag}")


def _ignored(name: str) -> tuple[str, ...]:
    """The catalog version moves with every CISA update; entries are frozen by date."""
    return ("catalog_version",) if name == KEV_FILE else ()


def _matches(truth_dir: Path, name: str, payload: dict[str, object]) -> bool:
    return same_content(truth_dir / name, payload, ignore=_ignored(name))


def _note_catalog(path: Path, current: str) -> None:
    try:
        frozen = load_kev_truth(path).catalog_version
    except TruthError:
        return
    if frozen != current:
        write_line(f"{KEV_FILE}: frozen from catalog {frozen}; feed is now {current}")


def _user_agent() -> str:
    value = os.environ.get("SEC_USER_AGENT", "").strip()
    if not value or value == _PLACEHOLDER_AGENT:
        raise ConfigError(
            "SEC_USER_AGENT must be set to your own contact string "
            "(SEC and CISA reject anonymous clients)"
        )
    return value
