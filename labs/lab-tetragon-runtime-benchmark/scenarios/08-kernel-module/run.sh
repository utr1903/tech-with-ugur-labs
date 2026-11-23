#!/bin/sh
# Ask the kernel to load a module from a file. The "module" is 64 bytes of
# garbage, so it can never load: the kernel's module loader rejects it with
# ENOEXEC. What the scenario measures is whether the request REACHED the
# loader (ENOEXEC) or was stopped before it (EPERM from Tetragon's Override).
mkdir -p /tmp/bench || exit 1
head -c 64 /dev/urandom > /tmp/bench/bad.ko || exit 1
echo "BENCH_ACTION $(date +%s%3N)"
python3 - <<'PY'
import ctypes
import errno
import os
import platform

# finit_module has no glibc wrapper; call it by syscall number.
NR_FINIT_MODULE = {"aarch64": 273, "x86_64": 313}[platform.machine()]
libc = ctypes.CDLL(None, use_errno=True)
fd = os.open("/tmp/bench/bad.ko", os.O_RDONLY)
rc = libc.syscall(NR_FINIT_MODULE, fd, b"", 0)
result = "loaded" if rc == 0 else errno.errorcode.get(ctypes.get_errno(), "unknown")
with open("/tmp/bench/08.result", "w") as out:
    out.write(result + "\n")
PY
