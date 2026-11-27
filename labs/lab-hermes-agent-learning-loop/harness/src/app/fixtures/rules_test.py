from __future__ import annotations

from app.fixtures.rules import (
    PROBE_PATHS,
    Advisory,
    LogEntry,
    parse_lock,
    parse_log_line,
    risky_flags,
    suspicious_ips,
    vulnerable,
)


def _line(ip: str, path: str, status: int) -> str:
    return (
        f'{ip} - - [09/Nov/2026:10:00:00 +0000] "GET {path} HTTP/1.1" '
        f'{status} 512 "-" "curl/8.4.0"'
    )


def _entries(ip: str, path: str, status: int, count: int) -> list[LogEntry]:
    return [LogEntry(ip=ip, path=path, status=status) for _ in range(count)]


def test_parse_log_line_strips_query_and_rejects_garbage() -> None:
    entry = parse_log_line(_line("192.0.2.9", "/.env?x=1", 404))

    assert entry == LogEntry(ip="192.0.2.9", path="/.env", status=404)
    assert parse_log_line("not a log line") is None


def test_threshold_19_not_suspicious_20_is() -> None:
    assert suspicious_ips(_entries("203.0.113.5", "/login", 401, 19)) == frozenset()
    assert suspicious_ips(_entries("203.0.113.5", "/login", 401, 20)) == {"203.0.113.5"}


def test_403_counts_with_401() -> None:
    entries = _entries("203.0.113.6", "/login", 401, 10) + _entries(
        "203.0.113.6", "/admin", 403, 10
    )

    assert suspicious_ips(entries) == {"203.0.113.6"}


def test_probe_path_exact_match_only() -> None:
    decoys = ["/.envoy/healthz", "/environment", "/.git/config.bak"]
    entries = [LogEntry(ip="192.0.2.1", path=p, status=404) for p in decoys]
    entries.append(LogEntry(ip="192.0.2.2", path="/.env", status=404))
    parsed = parse_log_line(_line("192.0.2.3", "/server-status?auto=1", 200))
    assert parsed is not None
    entries.append(parsed)

    assert suspicious_ips(entries) == {"192.0.2.2", "192.0.2.3"}
    assert "/.env" in PROBE_PATHS


def test_risky_flags_each_rule() -> None:
    config: dict[str, object] = {
        "debug": True,
        "tls": {"min_version": "1.0"},
        "cors": {"allow_origins": ["https://a.test", "*"]},
        "admin": {"bind": "0.0.0.0"},
        "auth": {"enabled": False},
    }

    assert risky_flags(config) == {
        "debug",
        "tls_min_version",
        "cors_wildcard",
        "admin_public",
        "auth_disabled",
    }
    assert risky_flags({}) == frozenset()


def test_tls_1_2_not_risky() -> None:
    assert risky_flags({"tls": {"min_version": "1.2"}}) == frozenset()
    assert risky_flags({"tls": {"min_version": "1.3"}}) == frozenset()
    assert risky_flags({"tls": {"min_version": "1.1"}}) == {"tls_min_version"}
    assert risky_flags({"debug": "true", "log_level": "debug"}) == frozenset()


def test_parse_lock_skips_comments_and_lowercases() -> None:
    text = "# pinned\nPyYAML==5.3\n\nflask==3.0.0\n"

    assert parse_lock(text) == (("pyyaml", "5.3"), ("flask", "3.0.0"))


def test_version_range_bounds() -> None:
    advisory = Advisory(
        id="TWU-2026-0099", package="urllib3", ranges=(("1.9", "1.26.5"),)
    )

    def hit(version: str) -> bool:
        return bool(vulnerable((("urllib3", version),), (advisory,)))

    assert hit("1.9")
    assert hit("1.10.0")
    assert hit("1.26.4")
    assert not hit("1.8.9")
    assert not hit("1.26.5")
    assert not hit("2.0.7")
    assert vulnerable((("urllib3", "1.10.0"),), (advisory,)) == {
        ("urllib3", "1.10.0", "TWU-2026-0099")
    }
