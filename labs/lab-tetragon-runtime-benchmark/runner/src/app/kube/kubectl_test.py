from __future__ import annotations

import pytest

from app.kube.kubectl import context_args


def test_context_defaults_to_lab_cluster(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KUBE_CONTEXT", raising=False)
    assert context_args() == ["--context", "kind-tetragon-bench"]


def test_context_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KUBE_CONTEXT", "other")
    assert context_args() == ["--context", "other"]
