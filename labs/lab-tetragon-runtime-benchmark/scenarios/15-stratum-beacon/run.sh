#!/bin/sh
# What a cryptominer does first: open a stratum connection to its pool and
# subscribe for work. The "pool" is the attacker pod.
echo "BENCH_ACTION $(date +%s%3N)"
timeout 10 python3 -c '
import socket
s = socket.create_connection(("attacker.attacker.svc", 3333), timeout=5)
s.sendall(b"{\"id\": 1, \"method\": \"mining.subscribe\", \"params\": []}\n")
s.close()
'
