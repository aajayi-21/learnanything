import math

import pytest

from learnloop.numeric import clamp, empirical_quantile, percentiles, sigmoid


def test_clamp_bounds() -> None:
    assert clamp(1.5) == 1.0
    assert clamp(-0.5) == 0.0
    assert clamp(0.4) == 0.4
    assert clamp(7.0, low=2.0, high=5.0) == 5.0


def test_sigmoid_symmetry_and_bounds() -> None:
    assert sigmoid(0.0) == 0.5
    assert sigmoid(2.0) == pytest.approx(1.0 - sigmoid(-2.0))
    assert 0.0 < sigmoid(-30.0) < 1e-12
    assert sigmoid(800.0) == 1.0  # no overflow
    assert sigmoid(-800.0) == pytest.approx(0.0)


def test_empirical_quantile_single_element() -> None:
    assert empirical_quantile([3.0], 0.0) == 3.0
    assert empirical_quantile([3.0], 0.5) == 3.0
    assert empirical_quantile([3.0], 1.0) == 3.0


def test_empirical_quantile_odd_n() -> None:
    values = [3.0, 1.0, 2.0]
    assert empirical_quantile(values, 0.5) == 2.0
    assert empirical_quantile(values, 0.0) == 1.0
    assert empirical_quantile(values, 1.0) == 3.0


def test_empirical_quantile_even_n_interpolates() -> None:
    values = [1.0, 2.0, 3.0, 4.0]
    assert empirical_quantile(values, 0.5) == pytest.approx(2.5)
    # numpy.percentile([1,2,3,4], 85, method="linear") == 3.55
    assert empirical_quantile(values, 0.85) == pytest.approx(3.55)


def test_empirical_quantile_unsorted_input() -> None:
    assert empirical_quantile([9.0, 1.0, 5.0, 7.0, 3.0], 0.75) == pytest.approx(7.0)


def test_empirical_quantile_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        empirical_quantile([], 0.5)
    with pytest.raises(ValueError):
        empirical_quantile([1.0], 1.5)


def test_percentiles_defaults_and_empty() -> None:
    assert percentiles([]) == {}
    result = percentiles([float(i) for i in range(1, 101)])
    assert result[0.50] == pytest.approx(50.5)
    assert result[0.90] == pytest.approx(90.1)
    assert set(result) == {0.10, 0.25, 0.50, 0.75, 0.90}


def test_percentiles_custom_qs() -> None:
    result = percentiles([1.0, 2.0, 3.0, 4.0], qs=(0.5,))
    assert result == {0.5: pytest.approx(2.5)}
    assert not math.isnan(result[0.5])
