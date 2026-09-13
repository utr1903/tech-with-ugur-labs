from __future__ import annotations

from app.api.admission import ExecutionSlots


def test_acquires_up_to_capacity_then_refuses_until_released() -> None:
    slots = ExecutionSlots(capacity=2)
    assert slots.try_acquire() is True
    assert slots.try_acquire() is True
    assert slots.try_acquire() is False
    assert slots.in_use == 2
    slots.release()
    assert slots.try_acquire() is True
