"""A non-blocking concurrency gate: full means 429 now, never a queue."""

from __future__ import annotations


class ExecutionSlots:
    """Counts running executions. Safe without locks on one event loop."""

    def __init__(self, *, capacity: int) -> None:
        self._capacity = capacity
        self._in_use = 0

    @property
    def in_use(self) -> int:
        """Executions currently holding a slot."""
        return self._in_use

    def try_acquire(self) -> bool:
        """Takes a slot if one is free."""
        if self._in_use >= self._capacity:
            return False
        self._in_use += 1
        return True

    def release(self) -> None:
        """Returns a slot."""
        self._in_use -= 1
