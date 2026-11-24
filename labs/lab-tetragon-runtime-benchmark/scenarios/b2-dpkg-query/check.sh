#!/bin/sh
# Succeeded if installed packages were listed.
grep -q '^ii' /tmp/bench/b2.out
