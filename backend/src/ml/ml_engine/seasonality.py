"""Seasonality helpers for aggregate and per-SKU forecasting."""

from __future__ import annotations

from .constants import SEASONALITY_CLAMP_DAILY, SEASONALITY_CLAMP_MONTHLY
from .dates import get_weekday_index
from .stats import safe_mean
from .utils import clamp, to_number


def build_daily_seasonality(paid_sales):
    revenue_totals = [0.0] * 7
    order_totals = [0.0] * 7
    counts = [0] * 7

    for sale in paid_sales:
        index = get_weekday_index(sale["date"])
        revenue_totals[index] += to_number(sale["total"])
        order_totals[index] += 1.0
        counts[index] += 1

    revenue_avgs = [revenue_totals[index] / counts[index] if counts[index] else 0.0 for index in range(7)]
    order_avgs = [order_totals[index] / counts[index] if counts[index] else 0.0 for index in range(7)]
    overall_revenue = safe_mean([value for value in revenue_avgs if value > 0])
    overall_orders = safe_mean([value for value in order_avgs if value > 0])
    low, high = SEASONALITY_CLAMP_DAILY

    return {
        "enabled": True,
        "type": "weekday",
        "revenue": [clamp(value / overall_revenue, low, high) if overall_revenue > 0 else 1.0 for value in revenue_avgs],
        "orders": [clamp(value / overall_orders, low, high) if overall_orders > 0 else 1.0 for value in order_avgs],
    }


def build_monthly_seasonality(paid_sales):
    revenue_totals = [0.0] * 12
    order_totals = [0.0] * 12
    counts = [0] * 12

    for sale in paid_sales:
        index = sale["date"].month - 1
        revenue_totals[index] += to_number(sale["total"])
        order_totals[index] += 1.0
        counts[index] += 1

    revenue_avgs = [revenue_totals[index] / counts[index] if counts[index] else 0.0 for index in range(12)]
    order_avgs = [order_totals[index] / counts[index] if counts[index] else 0.0 for index in range(12)]
    overall_revenue = safe_mean([value for value in revenue_avgs if value > 0])
    overall_orders = safe_mean([value for value in order_avgs if value > 0])
    low, high = SEASONALITY_CLAMP_MONTHLY

    return {
        "enabled": True,
        "type": "month-of-year",
        "revenue": [clamp(value / overall_revenue, low, high) if overall_revenue > 0 else 1.0 for value in revenue_avgs],
        "orders": [clamp(value / overall_orders, low, high) if overall_orders > 0 else 1.0 for value in order_avgs],
    }


def build_seasonality_profile(range_key, paid_sales):
    if range_key == "daily":
        return build_daily_seasonality(paid_sales)
    if range_key == "monthly":
        return build_monthly_seasonality(paid_sales)
    return {"enabled": False, "type": "none", "revenue": [], "orders": []}


def seasonality_factor(range_key, bucket_start, profile, channel):
    if not profile.get("enabled"):
        return 1.0
    if range_key == "daily":
        return to_number(profile.get(channel, [1.0] * 7)[get_weekday_index(bucket_start)], 1.0)
    if range_key == "monthly":
        return to_number(profile.get(channel, [1.0] * 12)[bucket_start.month - 1], 1.0)
    return 1.0
