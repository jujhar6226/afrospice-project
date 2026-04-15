"""Basic numeric helpers."""

from __future__ import annotations

import math


def to_number(value, fallback: float = 0.0) -> float:
    """Safely coerce a value to a finite float."""
    try:
        numeric = float(value)
        if math.isfinite(numeric):
            return numeric
    except (TypeError, ValueError):
        pass
    return fallback


def clamp(value: float, minimum: float, maximum: float) -> float:
    """Clamp a numeric value inside the provided range."""
    return max(minimum, min(maximum, value))


def round_value(value, digits: int = 2) -> float:
    """Round a value after numeric coercion."""
    return round(to_number(value), digits)
