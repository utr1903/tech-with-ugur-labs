#!/bin/sh
# Happened if a hostname was read and it is not the pod's own: the read ran
# in the host's mount namespace.
test -s /tmp/bench/07.out && ! cmp -s /tmp/bench/07.out /etc/hostname
