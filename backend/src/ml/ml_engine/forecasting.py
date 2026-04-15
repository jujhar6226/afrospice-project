"""Forecasting helpers for aggregate planning and confidence scoring."""

from __future__ import annotations

import math
from typing import Any

from .constants import (
    FORECAST_RESIDUAL_FLOOR_ORDERS,
    FORECAST_RESIDUAL_FLOOR_REVENUE,
    PREDICTION_INTERVAL_LABEL,
    PREDICTION_INTERVAL_Z,
    RANGE_HISTORY_POINTS,
)
from .dates import add_range_step, format_bucket_label, get_range_step_days, iso, start_of_range
from .seasonality import build_seasonality_profile, seasonality_factor
from .stats import calculate_wape, safe_mean, safe_std
from .utils import clamp, round_value, to_number


def fit_damped_holt(series, alpha: float = 0.42, beta: float = 0.18, phi: float = 0.92) -> dict[str, Any]:
    """Fit a damped Holt model to a non-negative time series."""
    cleaned = [max(0.0, to_number(value)) for value in series]
    if not cleaned:
        return {"level": 0.0, "trend": 0.0, "fitted": [], "residuals": []}

    level = cleaned[0]
    trend = cleaned[1] - cleaned[0] if len(cleaned) > 1 else 0.0
    fitted = [level]
    residuals = [0.0]

    for observed in cleaned[1:]:
        previous_level = level
        projected = max(0.0, level + phi * trend)
        level = alpha * observed + (1 - alpha) * projected
        trend = beta * (level - previous_level) + (1 - beta) * phi * trend
        fitted.append(max(0.0, projected))
        residuals.append(observed - projected)

    return {"level": level, "trend": trend, "fitted": fitted, "residuals": residuals}


def damped_holt_forecast(series, horizon: int, alpha: float = 0.42, beta: float = 0.18, phi: float = 0.92):
    """Project future values with a damped Holt trend model."""
    model = fit_damped_holt(series, alpha=alpha, beta=beta, phi=phi)
    projections = []
    for step in range(1, horizon + 1):
        if abs(1 - phi) < 1e-9:
            base = model["level"] + model["trend"] * step
        else:
            base = model["level"] + model["trend"] * (phi * (1 - phi**step) / (1 - phi))
        projections.append(max(0.0, base))
    return {
        "values": projections,
        "residuals": model["residuals"],
        "level": model["level"],
        "trend": model["trend"],
    }


def build_confidence_breakdown(
    history_points: int = 0,
    observed_points: int = 0,
    holdout_wape=None,
    horizon: int = 1,
    lead_samples: int = 0,
    data_quality_penalty: float = 0.0,
) -> dict[str, int | float]:
    """Expose the major components that contribute to confidence."""
    coverage_score = clamp((observed_points / history_points) * 30.0, 0.0, 30.0) if history_points else 0.0
    history_score = clamp(history_points * 2.0, 0.0, 22.0)
    error_score = 10.0 if holdout_wape is None else clamp(44.0 - to_number(holdout_wape) * 0.58, 4.0, 44.0)
    lead_time_score = clamp(lead_samples * 2.4, 0.0, 10.0)
    horizon_penalty = clamp((max(1, horizon) - 1) * 1.1, 0.0, 14.0)
    total = clamp(
        20.0 + coverage_score + history_score + error_score + lead_time_score - horizon_penalty - data_quality_penalty,
        18.0,
        97.0,
    )
    return {
        "coverageScore": round_value(coverage_score, 1),
        "historyScore": round_value(history_score, 1),
        "errorScore": round_value(error_score, 1),
        "leadTimeScore": round_value(lead_time_score, 1),
        "horizonPenalty": round_value(horizon_penalty, 1),
        "dataQualityPenalty": round_value(data_quality_penalty, 1),
        "total": int(round(total)),
    }


def get_forecast_confidence(**kwargs) -> int:
    """Compatibility helper that returns only the combined confidence score."""
    return int(build_confidence_breakdown(**kwargs)["total"])


def backtest_series(series, holdout_size: int):
    """Run a rolling holdout test and return the resulting WAPE."""
    if len(series) < 6 or holdout_size < 2 or holdout_size >= len(series):
        return {"holdoutPoints": 0, "wape": None}
    train = series[:-holdout_size]
    holdout = series[-holdout_size:]
    predicted = damped_holt_forecast(train, holdout_size)["values"]
    return {"holdoutPoints": len(holdout), "wape": calculate_wape(holdout, predicted)}


def build_range_series(range_key: str, paid_sales, anchor_date):
    """Build the historical aggregate series for the requested cadence."""
    history_points = RANGE_HISTORY_POINTS.get(range_key, RANGE_HISTORY_POINTS["monthly"])
    anchor_bucket = start_of_range(anchor_date, range_key)
    buckets = []
    for offset in range(history_points - 1, -1, -1):
        bucket_start = add_range_step(anchor_bucket, range_key, -offset)
        buckets.append(
            {
                "start": bucket_start,
                "label": format_bucket_label(bucket_start, range_key),
                "revenue": 0.0,
                "orders": 0.0,
            }
        )

    index = {iso(bucket["start"]): bucket for bucket in buckets}
    for sale in paid_sales:
        bucket_key = iso(start_of_range(sale["date"], range_key))
        if bucket_key not in index:
            continue
        index[bucket_key]["revenue"] += to_number(sale["total"])
        index[bucket_key]["orders"] += 1.0
    return buckets


def build_aggregate_periods(range_key: str, horizon: int, paid_sales, anchor_date):
    """Build the aggregate forecast periods used by reporting and executive views."""
    buckets = build_range_series(range_key, paid_sales, anchor_date)
    revenue_series = [bucket["revenue"] for bucket in buckets]
    order_series = [bucket["orders"] for bucket in buckets]
    seasonality = build_seasonality_profile(range_key, paid_sales)

    revenue_holdout = backtest_series(
        revenue_series,
        min(max(2, len(revenue_series) // 3), 4 if range_key in ("daily", "weekly") else 2),
    )
    order_holdout = backtest_series(
        order_series,
        min(max(2, len(order_series) // 3), 4 if range_key in ("daily", "weekly") else 2),
    )

    revenue_model = damped_holt_forecast(revenue_series, horizon)
    orders_model = damped_holt_forecast(order_series, horizon)
    revenue_residual_scale = max(FORECAST_RESIDUAL_FLOOR_REVENUE, safe_std(revenue_model["residuals"]))
    orders_residual_scale = max(FORECAST_RESIDUAL_FLOOR_ORDERS, safe_std(orders_model["residuals"]))
    blended_wape = safe_mean([value for value in [revenue_holdout["wape"], order_holdout["wape"]] if value is not None])
    confidence_breakdown = build_confidence_breakdown(
        history_points=len(buckets),
        observed_points=sum(1 for bucket in buckets if bucket["revenue"] > 0),
        holdout_wape=blended_wape if blended_wape > 0 else None,
        horizon=horizon,
        lead_samples=0,
    )
    confidence_score = int(confidence_breakdown["total"])

    periods = []
    last_bucket = buckets[-1]["start"] if buckets else start_of_range(anchor_date, range_key)
    for step in range(horizon):
        bucket_start = add_range_step(last_bucket, range_key, step + 1)
        revenue_factor = seasonality_factor(range_key, bucket_start, seasonality, "revenue")
        order_factor = seasonality_factor(range_key, bucket_start, seasonality, "orders")
        projected_revenue = max(0.0, revenue_model["values"][step] * revenue_factor)
        projected_orders = max(0.0, orders_model["values"][step] * order_factor)
        revenue_interval = PREDICTION_INTERVAL_Z * revenue_residual_scale * math.sqrt(step + 1)
        orders_interval = PREDICTION_INTERVAL_Z * orders_residual_scale * math.sqrt(step + 1)

        periods.append(
            {
                "label": format_bucket_label(bucket_start, range_key),
                "bucketStart": iso(bucket_start),
                "projectedRevenue": round_value(projected_revenue),
                "projectedOrders": int(round(projected_orders)),
                "projectedAverageOrderValue": round_value(projected_revenue / projected_orders if projected_orders > 0 else 0.0),
                "projectedRevenueLower": round_value(max(0.0, projected_revenue - revenue_interval)),
                "projectedRevenueUpper": round_value(projected_revenue + revenue_interval),
                "projectedOrdersLower": int(round(max(0.0, projected_orders - orders_interval))),
                "projectedOrdersUpper": int(round(projected_orders + orders_interval)),
                "confidenceScore": max(18, confidence_score - step * 4),
                "seasonalityFactor": round_value((revenue_factor + order_factor) / 2.0, 2),
            }
        )

    planning_days = clamp(get_range_step_days(range_key) * horizon, 7, 42)
    return {
        "overview": {
            "cadence": range_key,
            "horizon": horizon,
            "planningDays": int(planning_days),
            "confidenceScore": confidence_score,
            "confidenceBreakdown": confidence_breakdown,
            "revenueWape": revenue_holdout["wape"],
            "ordersWape": order_holdout["wape"],
            "trainingPoints": len(buckets),
            "latestObservedLabel": buckets[-1]["label"] if buckets else None,
            "predictionInterval": PREDICTION_INTERVAL_LABEL,
            "seasonalityType": seasonality.get("type"),
        },
        "periods": periods,
    }
