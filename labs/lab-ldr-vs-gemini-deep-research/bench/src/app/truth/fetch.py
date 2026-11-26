"""Downloads the public feeds the answer keys are built from."""

from __future__ import annotations

from collections.abc import Mapping

import httpx

from app.errors import FetchError
from app.logging_setup import Logger

KEV_FEED_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
MSFT_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000789019.json"


def fetch_json(client: httpx.Client, url: str, *, log: Logger) -> Mapping[str, object]:
    """Fetches `url` and returns its JSON object; anything else is a FetchError."""
    try:
        log.info("Fetching JSON...", url=url)
        body = _get_object(client, url)
    except FetchError:
        log.exception("Fetching JSON failed.", url=url)
        raise
    else:
        log.info("Fetching JSON succeeded.", url=url, keys=len(body))
        return body


def _get_object(client: httpx.Client, url: str) -> dict[str, object]:
    try:
        response = client.get(url)
    except httpx.HTTPError as err:
        raise FetchError(f"{url} could not be fetched: {err}") from err
    if response.status_code != httpx.codes.OK:
        raise FetchError(f"{url} returned HTTP {response.status_code}")
    try:
        body = response.json()
    except ValueError as err:
        raise FetchError(f"{url} did not return valid JSON") from err
    if not isinstance(body, dict):
        raise FetchError(f"{url} did not return a JSON object")
    return body
