import numpy as np

import labconfig
import report
import snapshot
import windows


def _results():
    shape = (labconfig.EXPECTED_ORIGINS, labconfig.HORIZON_HOURS)
    points = np.full(shape, 50.0, dtype=np.float32)
    spread = np.linspace(-10.0, 10.0, labconfig.N_QUANTILES, dtype=np.float32)
    quantiles = points[..., None] + spread
    names = [
        "seasonal-naive",
        "timesfm-univariate",
        "timesfm-past-only",
        "timesfm-past-future",
        "timesfm-both",
        "leaky-control",
    ]
    maes = [17.83, 15.0, 15.5, 14.5, 14.8, 6.0]
    return {
        name: {
            "points": points,
            "quantiles": quantiles,
            "scores": {
                "mae": mae,
                "rmse": mae * 1.3,
                "mase": mae / 17.83,
                "coverage": 0.8,
            },
        }
        for name, mae in zip(names, maes)
    }


def test_scoreboard_lists_every_configuration_and_marks_the_cheat():
    text = report.format_scoreboard(_results())
    for name in _results():
        assert name in text
    assert "MASE" in text
    # The leaky row must never read as a legitimate winner.
    leaky_line = next(line for line in text.splitlines() if "leaky-control" in line)
    assert "cheat" in leaky_line.lower() or "*" in leaky_line


def test_worst_episode_is_the_origin_containing_the_peak():
    truth = np.zeros((5, labconfig.HORIZON_HOURS), dtype=np.float32)
    truth[3, 7] = 200.0
    assert report.worst_episode_index(truth) == 3


def test_plot_writes_a_png(tmp_path):
    frame = snapshot.load_snapshot()
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    path = tmp_path / "episode.png"

    report.plot_episode(built, truth, _results(), report.worst_episode_index(truth), path)

    assert path.exists()
    assert path.stat().st_size > 5000
