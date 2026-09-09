import numpy as np

import scaling


def test_standardizes_each_channel_using_context_statistics_only():
    context = np.array([[10.0, 20.0, 30.0, 40.0]], dtype=np.float32)
    future = np.array([[1000.0]], dtype=np.float32)
    block = np.concatenate([context, future], axis=1)

    scaled = scaling.standardize_channels(block, n_context=4)

    # Mean and sd come from the first four values only.
    mean, sd = 25.0, np.std([10.0, 20.0, 30.0, 40.0])
    np.testing.assert_allclose(scaled[0, :4], (context[0] - mean) / sd, rtol=1e-5)
    np.testing.assert_allclose(scaled[0, 4], (1000.0 - mean) / sd, rtol=1e-5)


def test_channels_are_scaled_independently():
    block = np.array([[1.0, 2.0, 3.0], [1000.0, 2000.0, 3000.0]], dtype=np.float32)
    scaled = scaling.standardize_channels(block, n_context=3)
    np.testing.assert_allclose(scaled[0], scaled[1], rtol=1e-5)


def test_constant_channel_does_not_divide_by_zero():
    block = np.full((1, 5), 7.0, dtype=np.float32)
    scaled = scaling.standardize_channels(block, n_context=5)
    assert np.isfinite(scaled).all()
    np.testing.assert_allclose(scaled, 0.0, atol=1e-6)
