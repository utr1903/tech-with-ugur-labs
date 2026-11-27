"""The weekly triage runbook the agent reads, and the report schema."""

from __future__ import annotations

import json

from app.fixtures.config_rules import RISKY_FLAGS
from app.fixtures.rules import AUTH_FAIL_THRESHOLD, PROBE_PATHS

REPORT_SCHEMA_EXAMPLE: str = json.dumps(
    {
        "week": "week-1",
        "services": [
            {
                "service": "billing",
                "suspicious_ips": ["203.0.113.7"],
                "risky_config": ["debug"],
                "vulnerable_dependencies": [
                    {
                        "package": "pyyaml",
                        "version": "5.3",
                        "advisory_id": "TWU-2026-0001",
                    }
                ],
            }
        ],
    },
    indent=2,
)

_PROBE_LIST = "\n".join(f"  - `{path}`" for path in PROBE_PATHS)
_FLAG_LIST = ", ".join(f"`{flag}`" for flag in RISKY_FLAGS)

RUNBOOK_MD: str = f"""# Weekly fleet triage runbook

Each week folder holds one folder per service under `services/` and one
`advisories.json` for the whole fleet. Every service folder has an
`access.log` (nginx combined format), a `config.yaml` and a
`requirements.lock`. Apply the three checks below to every service.

## 1. Suspicious IP addresses

A client IP is suspicious when either of these is true in that service's
`access.log`:

- It received at least {AUTH_FAIL_THRESHOLD} responses with status 401 or 403,
  counting both statuses together. {AUTH_FAIL_THRESHOLD - 1} is not enough.
- It requested one of these paths, matched exactly after removing any
  query string (`?...`). A path that only starts with or contains one of
  them does not count:
{_PROBE_LIST}

## 2. Risky configuration

Read `config.yaml` and report each of these flags that applies, using
these flag names exactly: {_FLAG_LIST}.

- `debug`: the top-level `debug` key is the boolean `true`.
- `tls_min_version`: `tls.min_version` is below 1.2 (so 1.0 and 1.1).
  1.2 and 1.3 are fine.
- `cors_wildcard`: `cors.allow_origins` contains `"*"`.
- `admin_public`: `admin.bind` is `0.0.0.0`.
- `auth_disabled`: `auth.enabled` is the boolean `false`.

## 3. Vulnerable dependencies

`requirements.lock` pins packages as `name==version`; lines starting with
`#` are comments. `advisories.json` lists advisories, each with a package
and one or more affected ranges. A pinned version is affected when it is
at or above `introduced` and strictly below `fixed`. Compare versions
part by part as numbers, so 1.10.0 is newer than 1.9.0, and treat missing
parts as zero. Report the package name in lower case, the pinned version
and the advisory id.

## Report format

Write one JSON document with exactly this shape. Include one entry for
every service (all six), even when its lists are empty. Use the flag
names exactly as listed above and write IP addresses as plain strings.
Output plain JSON with no markdown fence around it.

{REPORT_SCHEMA_EXAMPLE}
"""
