"""Payload validation and option normalization."""

from __future__ import annotations

from copy import deepcopy

from .dates import parse_date
from .constants import (
    DEFAULT_MODEL_LIMIT,
    MAX_MODEL_LIMIT,
    MIN_MODEL_LIMIT,
    RANGE_HORIZON_DEFAULTS,
    RANGE_HORIZON_MAX,
)
from .utils import clamp, to_number

ALLOWED_RANGES = {"daily", "weekly", "monthly", "yearly"}
LIST_CONTEXT_KEYS = (
    "products",
    "sales",
    "purchaseOrders",
    "inventoryMovements",
    "cycleCounts",
    "customers",
    "suppliers",
    "users",
)


def validate_payload(raw_payload):
    """Validate and normalize the raw stdin payload before heavy computation."""
    if raw_payload is None:
        raw_payload = {}

    if not isinstance(raw_payload, dict):
        raise ValueError("ML payload must be a JSON object.")

    options = raw_payload.get("options") or {}
    context = raw_payload.get("context") or {}

    if not isinstance(options, dict):
        raise ValueError("ML payload options must be an object.")
    if not isinstance(context, dict):
        raise ValueError("ML payload context must be an object.")

    normalized_context = deepcopy(context)
    normalized_options = deepcopy(options)

    for key in LIST_CONTEXT_KEYS:
        value = normalized_context.get(key)
        if value is None:
            normalized_context[key] = []
            continue
        if not isinstance(value, list):
            raise ValueError(f"ML payload context.{key} must be a list.")

    settings = normalized_context.get("settings")
    if settings is None:
        normalized_context["settings"] = {}
    elif not isinstance(settings, dict):
        raise ValueError("ML payload context.settings must be an object.")

    latest_observed_at = parse_date(normalized_context.get("latestObservedAt"))
    normalized_context["latestObservedAt"] = latest_observed_at

    range_key = str(normalized_options.get("range") or "daily").strip().lower()
    if range_key not in ALLOWED_RANGES:
        range_key = "daily"
    normalized_options["range"] = range_key

    horizon_default = RANGE_HORIZON_DEFAULTS[range_key]
    horizon_max = RANGE_HORIZON_MAX[range_key]
    normalized_options["horizon"] = int(
        clamp(to_number(normalized_options.get("horizon"), horizon_default), 1, horizon_max)
    )
    normalized_options["limit"] = int(
        clamp(to_number(normalized_options.get("limit"), DEFAULT_MODEL_LIMIT), MIN_MODEL_LIMIT, MAX_MODEL_LIMIT)
    )

    return normalized_options, normalized_context
