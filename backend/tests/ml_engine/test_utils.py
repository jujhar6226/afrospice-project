from ml_engine.stats import calculate_wape
from ml_engine.utils import clamp, round_value, to_number


def test_to_number_invalid_returns_fallback():
    assert to_number("abc", 5.0) == 5.0


def test_to_number_valid_numeric_string():
    assert to_number("12.4") == 12.4


def test_clamp_respects_bounds():
    assert clamp(12.0, 0.0, 10.0) == 10.0


def test_round_value_uses_numeric_coercion():
    assert round_value("3.14159", 2) == 3.14


def test_calculate_wape_handles_zero_actual_series():
    assert calculate_wape([0, 0, 0], [1, 2, 3]) == 200.0
