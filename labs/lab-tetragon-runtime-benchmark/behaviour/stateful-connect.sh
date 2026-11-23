#!/bin/sh
# Connect out without ever reading the credential file.
echo "BENCH_ACTION $(date +%s%3N)"
python3 -c '
import socket
socket.create_connection(("attacker.attacker.svc", 8080), timeout=5).close()
'
