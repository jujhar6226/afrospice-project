"""Shared statistical helpers for the ML engine."""

from __future__ import annotations

import math
from statistics import mean

from .utils import clamp, round_value, to_number


def safe_mean(values) -> float:
    cleaned = [to_number(value) for value in values if value is not None]
    return mean(cleaned) if cleaned else 0.0


def safe_std(values) -> float:
    cleaned = [to_number(value) for value in values if value is not None]
    if len(cleaned) <= 1:
        return 0.0
    avg = safe_mean(cleaned)
    variance = sum((value - avg) ** 2 for value in cleaned) / len(cleaned)
    return math.sqrt(max(0.0, variance))


def percentile(values, q: float) -> float:
    cleaned = sorted(to_number(value) for value in values if value is not None)
    if not cleaned:
        return 0.0
    if len(cleaned) == 1:
        return cleaned[0]
    position = clamp(q, 0.0, 1.0) * (len(cleaned) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return cleaned[lower]
    weight = position - lower
    return cleaned[lower] * (1 - weight) + cleaned[upper] * weight


def calculate_wape(actual, predicted):
    if not actual or len(actual) != len(predicted):
        return None
    absolute_error = sum(abs(to_number(a) - to_number(p)) for a, p in zip(actual, predicted))
    actual_total = sum(abs(to_number(a)) for a in actual)
    if actual_total <= 0:
        baseline = max(1.0, safe_mean(actual))
        return round_value((absolute_error / (len(actual) * baseline)) * 100.0, 1)
    return round_value((absolute_error / actual_total) * 100.0, 1)


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))
