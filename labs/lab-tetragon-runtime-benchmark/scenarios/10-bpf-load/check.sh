#!/bin/sh
# Happened if the kernel accepted the program and returned a file descriptor.
grep -q '^loaded fd=' /tmp/bench/10.result 2>/dev/null
