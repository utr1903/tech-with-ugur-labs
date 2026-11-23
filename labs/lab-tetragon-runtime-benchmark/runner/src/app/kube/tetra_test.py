from __future__ import annotations

from app.kube.tetra import parse_policy_list, probe_has_override

COLUMNS = (
    ("ID", 5),
    ("NAME", 18),
    ("DOMAIN", 9),
    ("STATE", 10),
    ("FILTERID", 11),
    ("NAMESPACE", 12),
    ("SENSORS", 17),
    ("KERNELMEMORY", 15),
    ("MODE", 10),
    ("NPOST", 8),
    ("NENFORCE", 11),
    ("NMONITOR", 0),
)


def _row(*values: str) -> str:
    cells = (v.ljust(w) for v, (_, w) in zip(values, COLUMNS, strict=True))
    return "".join(cells).rstrip()


HEADER = _row(*(name for name, _ in COLUMNS))
LISTING = "\n".join(
    [
        HEADER,
        _row(
            "3",
            "scratch-sigkill",
            "k8s",
            "enabled",
            "3",
            "(global)",
            "generic_kprobe",
            "1.04 MB",
            "monitor",
            "1",
            "0",
            "1",
        ),
        _row(
            "4",
            "lab-exec",
            "k8s",
            "loading",
            "4",
            "(global)",
            "generic_kprobe",
            "0 B",
            "enforce",
            "0",
            "0",
            "0",
        ),
    ]
)


def test_parses_state_and_mode_despite_spaces_in_memory_column() -> None:
    assert parse_policy_list(LISTING) == {
        "scratch-sigkill": ("enabled", "monitor"),
        "lab-exec": ("loading", "enforce"),
    }


def test_header_only_is_empty() -> None:
    assert parse_policy_list(HEADER) == {}


def test_unknown_layout_is_empty() -> None:
    assert parse_policy_list("garbage\nmore garbage\n") == {}
    assert parse_policy_list("") == {}


def test_probe_detects_override() -> None:
    assert probe_has_override("foo: true\noverride_return: true\n")
    assert not probe_has_override("override_return: false\n")
    assert not probe_has_override("")
