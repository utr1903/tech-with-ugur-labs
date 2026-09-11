from __future__ import annotations

from app import config
from app.eval import experiments


def test_there_are_six_configurations_in_scoreboard_order() -> None:
    names = [e.name for e in experiments.EXPERIMENTS]
    assert names == [
        "seasonal-naive",
        "timesfm-univariate",
        "timesfm-past-only",
        "timesfm-past-future",
        "timesfm-both",
        "leaky-control",
    ]


def test_the_unknowable_pollutants_are_past_only() -> None:
    experiment = experiments.by_name("timesfm-past-only")
    assert experiment.past_only == ("nitrogen_dioxide", "carbon_monoxide")
    assert experiment.past_future == ()
    assert not experiment.leaky


def test_the_forecastable_weather_is_past_future() -> None:
    experiment = experiments.by_name("timesfm-past-future")
    assert experiment.past_future == config.WEATHER_VARIABLES
    assert experiment.past_only == ()


def test_both_carries_each_kind_in_its_proper_slot() -> None:
    experiment = experiments.by_name("timesfm-both")
    assert experiment.past_only == ("nitrogen_dioxide", "carbon_monoxide")
    assert experiment.past_future == config.WEATHER_VARIABLES


def test_the_leaky_control_is_flagged_and_cheats_in_the_documented_way() -> None:
    experiment = experiments.by_name("leaky-control")
    assert experiment.leaky
    # It is handed tomorrow's pollutants as though they were forecastable.
    assert experiment.past_future == ("nitrogen_dioxide", "carbon_monoxide")
    assert "cheat" in experiment.blurb.lower()


def test_only_the_baseline_is_not_a_model() -> None:
    kinds = {e.name: e.kind for e in experiments.EXPERIMENTS}
    assert kinds["seasonal-naive"] == "naive"
    assert all(
        kind == "timesfm" for name, kind in kinds.items() if name != "seasonal-naive"
    )
