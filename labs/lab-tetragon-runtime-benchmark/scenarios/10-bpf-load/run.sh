#!/bin/sh
# Load a two-instruction eBPF socket filter (r0 = 0; exit). It does nothing,
# but a program that loads could just as well hide processes or tamper with
# other eBPF security tools.
mkdir -p /tmp/bench || exit 1
echo "BENCH_ACTION $(date +%s%3N)"
python3 - <<'PY'
import ctypes
import errno
import platform
import struct

NR_BPF = {"aarch64": 280, "x86_64": 321}[platform.machine()]
BPF_PROG_LOAD = 5
BPF_PROG_TYPE_SOCKET_FILTER = 1
# struct bpf_insn: u8 code, u8 dst:4/src:4, s16 off, s32 imm
insns = struct.pack("<BBhi", 0xB7, 0, 0, 0) + struct.pack("<BBhi", 0x95, 0, 0, 0)
prog = ctypes.create_string_buffer(insns)
license_ = ctypes.create_string_buffer(b"GPL")
# union bpf_attr, PROG_LOAD part: prog_type, insn_cnt, insns, license,
# log_level, log_size, log_buf, kern_version; zero-padded.
attr = struct.pack(
    "<IIQQIIQI",
    BPF_PROG_TYPE_SOCKET_FILTER,
    2,
    ctypes.addressof(prog),
    ctypes.addressof(license_),
    0,
    0,
    0,
    0,
).ljust(128, b"\0")
buf = ctypes.create_string_buffer(attr, len(attr))
libc = ctypes.CDLL(None, use_errno=True)
fd = libc.syscall(NR_BPF, BPF_PROG_LOAD, buf, len(attr))
if fd >= 0:
    result = f"loaded fd={fd}"
else:
    result = errno.errorcode.get(ctypes.get_errno(), "unknown")
with open("/tmp/bench/10.result", "w") as out:
    out.write(result + "\n")
PY
