#!/bin/sh
# Copy a binary into an anonymous memory file and execute it from there,
# so nothing new is written to disk. The payload is `touch`.
mkdir -p /tmp/bench
echo "BENCH_ACTION $(date +%s%3N)"
python3 -c "
import os
fd = os.memfd_create('payload', 0)
with open('/usr/bin/touch', 'rb') as src:
    os.write(fd, src.read())
os.execve(fd, ['payload', '/tmp/bench/03.done'], {})
"
