"""Bytecode-aware scanner: diff a module's source against its shipped .pyc,
then disassemble any mismatch to name what the compiled form actually does."""

import importlib.util
import marshal
from dataclasses import dataclass

SUSPICIOUS_NAMES = {
    "environ", "getenv", "system", "popen", "open", "write", "connect", "socket",
}


@dataclass
class ScanResult:
    module: str
    mismatch: bool
    suspicious: list


def load_pyc_code(pyc_path):
    with open(pyc_path, "rb") as fh:
        fh.read(16)  # skip the 16-byte pyc header (PEP 552)
        return marshal.load(fh)


def find_suspicious(code, acc=None):
    acc = [] if acc is None else acc
    for name in code.co_names:
        if name in SUSPICIOUS_NAMES:
            acc.append(name)
    for const in code.co_consts:
        if isinstance(const, str) and const.startswith("/tmp"):
            acc.append("path:" + const)
        if hasattr(const, "co_code"):  # nested code object
            find_suspicious(const, acc)
    return acc


def scan_module(py_path, pyc_path=None):
    pyc_path = pyc_path or importlib.util.cache_from_source(py_path)
    shipped = load_pyc_code(pyc_path)
    recompiled = compile(open(py_path).read(), py_path, "exec")
    mismatch = (
        shipped.co_code != recompiled.co_code
        or set(shipped.co_names) != set(recompiled.co_names)
    )
    suspicious = find_suspicious(shipped) if mismatch else []
    # de-dupe while preserving order
    seen = {}
    suspicious = [seen.setdefault(x, x) for x in suspicious if x not in seen]
    return ScanResult(py_path, mismatch, suspicious)
