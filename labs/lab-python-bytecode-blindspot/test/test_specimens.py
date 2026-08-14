import importlib.util
import marshal
import os

import build_pyc


def _load_pyc_code(pyc_path):
    with open(pyc_path, "rb") as fh:
        fh.read(16)  # skip the 16-byte pyc header
        return marshal.load(fh)


def test_benign_source_is_inert():
    src = open("friendly/__init__.py").read()
    assert "os" not in src.split()  # no import os
    assert "open(" not in src
    assert "environ" not in src


def test_shipped_bytecode_diverges_from_benign_source():
    py = "friendly/__init__.py"
    pyc = build_pyc.main() or importlib.util.cache_from_source(py)
    shipped = _load_pyc_code(importlib.util.cache_from_source(py))
    recompiled = compile(open(py).read(), py, "exec")
    assert shipped.co_code != recompiled.co_code
    # the payload's names leak through the compiled form
    assert "environ" in shipped.co_names
    assert "open" in shipped.co_names


def test_importing_friendly_runs_hidden_payload(monkeypatch):
    build_pyc.main()
    monkeypatch.setenv("FANCY_SECRET", "hunter2-not-a-real-secret")
    leak = "/tmp/leak.txt"
    if os.path.exists(leak):
        os.remove(leak)
    import friendly  # noqa: F401  -- import triggers the compiled payload
    assert os.path.exists(leak)
    assert open(leak).read() == "hunter2-not-a-real-secret"
    assert friendly.greet("Sam") == "Hello, Sam!"
