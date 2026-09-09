from __future__ import annotations

import numpy as np

from app import config
from app.commands import plot
from app.data import snapshot
from app.forecast import windows


def test_worst_episode_is_the_origin_containing_the_peak():
    truth = np.zeros((5, config.HORIZON_HOURS), dtype=np.float32)
    truth[3, 7] = 200.0
    assert plot.worst_episode_index(truth) == 3


def test_plot_writes_a_png(tmp_path, results, log):
    frame = snapshot.load_snapshot(log=log)
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    path = tmp_path / "episode.png"

    plot.plot_episode(
        built, truth, results, plot.worst_episode_index(truth), path, log=log
    )

    assert path.exists()
    assert path.stat().st_size > 5000
