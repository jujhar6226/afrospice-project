"""Inventory forecasting, stock risk, and SKU explainability."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import timedelta

from .constants import (
    CATEGORY_FALLBACK_BASE_BLEND,
    CATEGORY_FALLBACK_MAX_BLEND,
    CONFIDENCE_INTEGRITY_PENALTY,
    CONFIDENCE_SUPPLIER_PENALTY,
    DEFAULT_HISTORY_DAYS,
    DEFAULT_LEAD_TIME_DAYS,
    DEFAULT_SERVICE_LEVEL_Z,
    INTERMITTENT_BLEND,
    INTERMITTENT_ZERO_RATIO,
    SERVICE_LEVELS_BY_POLICY,
    SPARSE_HISTORY_OBSERVED_DAYS,
    SPARSE_HISTORY_UNITS,
    STOCKOUT_CRITICAL_PROBABILITY,
    STOCKOUT_HIGH_PROBABILITY,
    STOCKOUT_INTEGRITY_ADJUSTMENT,
    STOCKOUT_MEDIUM_PROBABILITY,
    STOCKOUT_SUPPLIER_ADJUSTMENT,
    TREND_FALL_PCT,
    TREND_RISE_PCT,
)
from .dates import get_weekday_index, iso, start_of_day
from .forecasting import backtest_series, build_confidence_breakdown, damped_holt_forecast
from .stats import normal_cdf, safe_mean, safe_std
from .supplier import build_inbound_by_product, build_lead_times, normalize_supplier_name
from .utils import clamp, round_value, to_number


def build_stock_integrity_maps(products, inventory_movements, cycle_counts):
    """Summarize adjustment noise and count variance into a stock-integrity signal."""
    signals = {
        str(product["id"]): {
            "movementEvents": 0,
            "negativeAdjustmentUnits": 0.0,
            "nonSalesNegativeUnits": 0.0,
            "cycleVarianceUnits": 0.0,
            "cycleVarianceEvents": 0,
            "integrityRisk": 0.0,
        }
        for product in products
        if product.get("id") is not None
    }

    sales_like_types = {"sale", "sale_capture", "sale_refund", "sale_reversal", "purchase_receive", "restock"}

    for movement in inventory_movements:
        product_id = movement.get("productId")
        if product_id is None:
            continue
        product_key = str(product_id)
        if product_key not in signals:
            signals[product_key] = {
                "movementEvents": 0,
                "negativeAdjustmentUnits": 0.0,
                "nonSalesNegativeUnits": 0.0,
                "cycleVarianceUnits": 0.0,
                "cycleVarianceEvents": 0,
                "integrityRisk": 0.0,
            }
        delta = to_number(movement.get("quantityDelta"))
        movement_type = str(movement.get("movementType") or "").strip().lower()
        signals[product_key]["movementEvents"] += 1
        if delta < 0:
            signals[product_key]["negativeAdjustmentUnits"] += abs(delta)
            if movement_type not in sales_like_types:
                signals[product_key]["nonSalesNegativeUnits"] += abs(delta)

    for count in cycle_counts:
        for item in count.get("items") or []:
            product_id = item.get("productId")
            if product_id is None:
                continue
            product_key = str(product_id)
            if product_key not in signals:
                signals[product_key] = {
                    "movementEvents": 0,
                    "negativeAdjustmentUnits": 0.0,
                    "nonSalesNegativeUnits": 0.0,
                    "cycleVarianceUnits": 0.0,
                    "cycleVarianceEvents": 0,
                    "integrityRisk": 0.0,
                }
            variance_units = abs(to_number(item.get("varianceQty")))
            if variance_units > 0:
                signals[product_key]["cycleVarianceUnits"] += variance_units
                signals[product_key]["cycleVarianceEvents"] += 1

    for value in signals.values():
        movement_component = min(1.0, value["nonSalesNegativeUnits"] / max(4.0, value["negativeAdjustmentUnits"] + 1.0))
        cycle_component = min(1.0, value["cycleVarianceUnits"] / max(4.0, value["cycleVarianceUnits"] + 4.0))
        event_component = min(1.0, (value["movementEvents"] * 0.05) + (value["cycleVarianceEvents"] * 0.18))
        value["integrityRisk"] = round_value(
            clamp(movement_component * 0.45 + cycle_component * 0.35 + event_component * 0.20, 0.0, 1.0),
            4,
        )

    return signals


def build_daily_product_series(products, paid_sales, reference_date):
    """Build product- and category-level daily demand series for SKU forecasting."""
    end_date = start_of_day(reference_date)
    start_date = end_date - timedelta(days=DEFAULT_HISTORY_DAYS - 1)
    index_by_day = {}
    for offset in range(DEFAULT_HISTORY_DAYS):
        key = iso(start_date + timedelta(days=offset))
        index_by_day[key] = offset

    product_category = {
        str(product["id"]): (product.get("category") or "General")
        for product in products
        if product.get("id") is not None
    }
    category_counts = defaultdict(int)
    for category in product_category.values():
        category_counts[category] += 1

    series_by_product = {
        str(product["id"]): [0.0] * DEFAULT_HISTORY_DAYS
        for product in products
        if product.get("id") is not None
    }
    series_by_category = {
        category: [0.0] * DEFAULT_HISTORY_DAYS
        for category in category_counts
    }
    last_sale_at = {}
    weekday_units = defaultdict(lambda: [0.0] * 7)
    weekday_counts = defaultdict(lambda: [0] * 7)
    category_weekday_units = defaultdict(lambda: [0.0] * 7)
    category_weekday_counts = defaultdict(lambda: [0] * 7)

    for sale in paid_sales:
        sale_day = start_of_day(sale["date"])
        day_key = iso(sale_day)
        if day_key not in index_by_day:
            continue
        day_index = index_by_day[day_key]
        weekday_index = get_weekday_index(sale_day)

        for item in sale["items"]:
            product_id = item.get("id")
            if product_id is None:
                continue
            product_key = str(product_id)
            if product_key not in series_by_product:
                series_by_product[product_key] = [0.0] * DEFAULT_HISTORY_DAYS
            qty = max(0.0, to_number(item.get("qty")))
            category = product_category.get(product_key) or item.get("category") or "General"
            series_by_product[product_key][day_index] += qty
            series_by_category.setdefault(category, [0.0] * DEFAULT_HISTORY_DAYS)[day_index] += qty
            weekday_units[product_key][weekday_index] += qty
            weekday_counts[product_key][weekday_index] += 1
            category_weekday_units[category][weekday_index] += qty
            category_weekday_counts[category][weekday_index] += 1
            if product_key not in last_sale_at or sale["date"] > last_sale_at[product_key]:
                last_sale_at[product_key] = sale["date"]

    weekday_profiles = {}
    for product_key, totals in weekday_units.items():
        counts = weekday_counts[product_key]
        averages = [totals[index] / counts[index] if counts[index] else 0.0 for index in range(7)]
        overall = safe_mean([value for value in averages if value > 0])
        weekday_profiles[product_key] = [clamp(value / overall, 0.65, 1.4) if overall > 0 else 1.0 for value in averages]

    category_weekday_profiles = {}
    for category, totals in category_weekday_units.items():
        counts = category_weekday_counts[category]
        averages = [totals[index] / counts[index] if counts[index] else 0.0 for index in range(7)]
        overall = safe_mean([value for value in averages if value > 0])
        category_weekday_profiles[category] = [clamp(value / overall, 0.70, 1.35) if overall > 0 else 1.0 for value in averages]

    return {
        "seriesByProduct": series_by_product,
        "seriesByCategory": series_by_category,
        "categoryCounts": dict(category_counts),
        "lastSaleAtByProduct": last_sale_at,
        "weekdayProfiles": weekday_profiles,
        "categoryWeekdayProfiles": category_weekday_profiles,
    }


def get_trend_direction(recent_average: float, previous_average: float) -> str:
    if recent_average <= 0 and previous_average <= 0:
        return "flat"
    if previous_average <= 0 and recent_average > 0:
        return "rising"
    change = ((recent_average - previous_average) / max(previous_average, 0.01)) * 100.0
    if change >= TREND_RISE_PCT:
        return "rising"
    if change <= TREND_FALL_PCT:
        return "falling"
    return "stable"


def compute_stockout_probability(mean_demand: float, std_demand: float, available_units: float) -> float:
    if mean_demand <= 0:
        return 0.0
    if std_demand <= 0:
        return 1.0 if available_units < mean_demand else 0.0
    z_score = (available_units - mean_demand) / std_demand
    return clamp(1.0 - normal_cdf(z_score), 0.0, 1.0)


def build_risk_level(
    stockout_probability: float,
    days_cover,
    lead_time_p90: float,
    recommended_order_qty: int,
    current_stock: float,
    inbound_units: float,
) -> str:
    if current_stock <= 0 and inbound_units <= 0 and stockout_probability >= STOCKOUT_CRITICAL_PROBABILITY:
        return "critical"
    if stockout_probability >= STOCKOUT_HIGH_PROBABILITY or (
        recommended_order_qty > 0 and (days_cover is None or days_cover < lead_time_p90)
    ):
        return "high"
    if stockout_probability >= STOCKOUT_MEDIUM_PROBABILITY or recommended_order_qty > 0:
        return "medium"
    return "low"


def build_risk_reason(name: str, risk_level: str, days_cover, stockout_probability: float, lead_time_p90: float, inbound_units: float, trend_direction: str) -> str:
    probability_text = f"{int(round(stockout_probability * 100))}%"
    if risk_level == "critical":
        return f"{name} is projected to run short before the next likely replenishment window, with roughly {probability_text} stockout probability."
    if risk_level == "high":
        return f"{name} has elevated break-risk over the lead-time window and should be covered before demand closes the gap."
    if risk_level == "medium":
        return f"{name} is approaching the upper lead-time pressure band and should stay on the reorder watchlist."
    if days_cover is not None and days_cover > lead_time_p90 * 2 and inbound_units > 0:
        return f"{name} has enough cover plus inbound stock to stay stable under the current demand profile."
    if trend_direction == "rising":
        return f"{name} demand is rising, but stock still looks manageable under the current model."
    return f"{name} is not showing immediate replenishment stress."


def _get_demand_pattern(observed_days: int, total_units: float) -> str:
    zero_ratio = 1.0 - (observed_days / max(1, DEFAULT_HISTORY_DAYS))
    if observed_days <= 0 or total_units <= 0:
        return "cold-start"
    if zero_ratio >= INTERMITTENT_ZERO_RATIO:
        return "intermittent"
    if observed_days < SPARSE_HISTORY_OBSERVED_DAYS or total_units < SPARSE_HISTORY_UNITS:
        return "sparse"
    return "stable"


def _get_category_fallback_blend(observed_days: int, total_units: float) -> float:
    if observed_days >= SPARSE_HISTORY_OBSERVED_DAYS and total_units >= SPARSE_HISTORY_UNITS:
        return 0.0
    observed_gap = max(0.0, SPARSE_HISTORY_OBSERVED_DAYS - observed_days) / max(1.0, SPARSE_HISTORY_OBSERVED_DAYS)
    unit_gap = max(0.0, SPARSE_HISTORY_UNITS - total_units) / max(1.0, SPARSE_HISTORY_UNITS)
    gap_score = clamp(max(observed_gap, unit_gap), 0.0, 1.0)
    return round_value(
        CATEGORY_FALLBACK_BASE_BLEND + gap_score * (CATEGORY_FALLBACK_MAX_BLEND - CATEGORY_FALLBACK_BASE_BLEND),
        4,
    )


def _build_data_quality_warnings(observed_days: int, lead_samples: int, integrity_risk: float, category_blend: float):
    warnings = []
    if observed_days < SPARSE_HISTORY_OBSERVED_DAYS:
        warnings.append(f"Only {observed_days} selling day(s) were observed inside the training window.")
    if lead_samples <= 0:
        warnings.append("Lead-time history is missing, so supplier timing relies on fallback averages.")
    if integrity_risk >= 0.35:
        warnings.append("Inventory integrity noise is elevated because recent adjustments or count variances were detected.")
    if category_blend >= 0.25:
        warnings.append("Category fallback is contributing materially because SKU history is sparse.")
    return warnings[:4]


def _build_top_drivers(
    stockout_probability: float,
    trend_direction: str,
    supplier_delay_risk: float,
    integrity_risk: float,
    inbound_units: float,
    category_blend: float,
    stock_policy_class: str,
    cash_priority_tier: str,
):
    drivers = []
    if stockout_probability >= STOCKOUT_HIGH_PROBABILITY:
        drivers.append("Projected stockout probability is above the safe operating band.")
    if trend_direction == "rising":
        drivers.append("Recent demand trend is rising.")
    if inbound_units <= 0:
        drivers.append("No inbound replenishment is currently protecting this SKU.")
    if supplier_delay_risk >= 0.42:
        drivers.append("Supplier execution risk is adding timing pressure.")
    if integrity_risk >= 0.30:
        drivers.append("Inventory integrity noise is reducing confidence in on-hand stock.")
    if category_blend >= 0.25:
        drivers.append("Category demand fallback is being used to stabilize sparse history.")
    if stock_policy_class == "protect":
        drivers.append("This SKU sits in the business protection tier and should not be left uncovered.")
    if cash_priority_tier == "defer":
        drivers.append("Working capital should be deployed cautiously until sell-through improves.")
    return drivers[:4]


def _get_velocity_band(forecast_daily_units: float, demand_pattern: str, observed_days: int) -> str:
    if demand_pattern == "cold-start" or observed_days <= 0:
        return "unknown"
    if demand_pattern == "intermittent":
        return "intermittent"
    if forecast_daily_units >= 1.75:
        return "fast"
    if forecast_daily_units >= 0.75:
        return "steady"
    if forecast_daily_units >= 0.18:
        return "slow"
    return "minimal"


def _build_stock_policy_class(
    velocity_band: str,
    trend_direction: str,
    gross_margin_pct: float,
    confidence_score: float,
    demand_pattern: str,
) -> str:
    if velocity_band == "fast" or (
        (trend_direction == "rising" or velocity_band == "steady")
        and confidence_score >= 48
        and gross_margin_pct >= 14
    ):
        return "protect"

    if gross_margin_pct >= 30 and velocity_band != "minimal" and confidence_score >= 42:
        return "protect"

    if velocity_band == "steady" or trend_direction == "rising":
        return "staple"

    if demand_pattern == "intermittent" or confidence_score < 40 or gross_margin_pct < 12:
        return "cautious"

    return "standard"


def _get_service_level_for_policy(stock_policy_class: str):
    return SERVICE_LEVELS_BY_POLICY.get(stock_policy_class, SERVICE_LEVELS_BY_POLICY["standard"])


def _build_policy_reason(
    stock_policy_class: str,
    velocity_band: str,
    trend_direction: str,
    gross_margin_pct: float,
    confidence_score: float,
    demand_pattern: str,
) -> str:
    if stock_policy_class == "protect":
        if velocity_band == "fast":
            return "Fast-moving revenue line with enough evidence to justify aggressive protection."
        return "Margin or trend quality is strong enough that this SKU deserves higher service protection."

    if stock_policy_class == "staple":
        return "Steady demand makes this a core replenishment line, but not the most capital-intensive one."

    if stock_policy_class == "cautious":
        if demand_pattern == "intermittent":
            return "Demand is intermittent, so buying should stay disciplined until more consistent sell-through appears."
        if gross_margin_pct < 12:
            return "Margin yield is thin, so capital should be allocated cautiously."
        if confidence_score < 40:
            return "Model confidence is still thin, so this SKU should not be overprotected yet."
        return "This SKU should stay on a capital-disciplined policy until evidence improves."

    return "Balanced service policy with standard protection and standard reorder timing."


def _build_cash_priority_score(
    risk_level: str,
    stockout_probability: float,
    gross_margin_pct: float,
    forecast_revenue: float,
    supplier_delay_risk: float,
    confidence_score: float,
    stock_policy_class: str,
    demand_pattern: str,
    order_spend: float,
) -> float:
    risk_weight = 22 if risk_level == "critical" else 14 if risk_level == "high" else 7 if risk_level == "medium" else 0
    revenue_weight = min(24.0, max(0.0, to_number(forecast_revenue) / 28.0))
    margin_weight = max(0.0, min(20.0, (to_number(gross_margin_pct) - 8.0) * 0.55))
    confidence_weight = max(0.0, min(12.0, (to_number(confidence_score) - 35.0) * 0.24))
    supplier_weight = clamp(to_number(supplier_delay_risk), 0.0, 1.0) * 10.0
    if stock_policy_class == "protect":
        policy_bias = 12.0
    elif stock_policy_class == "staple":
        policy_bias = 6.0
    elif stock_policy_class == "cautious":
        policy_bias = -12.0
    else:
        policy_bias = 0.0
    intermittent_penalty = 7.0 if demand_pattern == "intermittent" else 0.0
    capital_return = (
        min(12.0, max(0.0, (to_number(forecast_revenue) / max(1.0, order_spend)) * 3.0))
        if order_spend > 0
        else 0.0
    )

    return round_value(
        clamp(
            to_number(stockout_probability) * 42.0
            + risk_weight
            + revenue_weight
            + margin_weight
            + confidence_weight
            + supplier_weight
            + policy_bias
            + capital_return
            - intermittent_penalty,
            0.0,
            100.0,
        ),
        1,
    )


def _get_cash_priority_tier(score: float) -> str:
    if score >= 78:
        return "protect-now"
    if score >= 60:
        return "invest-next"
    if score >= 42:
        return "watch"
    return "defer"


def _build_cash_priority_reason(
    cash_priority_tier: str,
    order_spend: float,
    stock_policy_class: str,
    forecast_revenue: float,
) -> str:
    if cash_priority_tier == "protect-now":
        return (
            f"Protect this line first. The expected demand and risk justify roughly "
            f"{round_value(order_spend)} in immediate inventory spend."
        )
    if cash_priority_tier == "invest-next":
        return (
            f"This line deserves near-term inventory capital, with about {round_value(order_spend)} "
            f"in suggested spend supporting {round_value(forecast_revenue)} in forecast revenue."
        )
    if cash_priority_tier == "watch":
        return "Keep this line funded but controlled while monitoring demand and supplier timing."
    if stock_policy_class == "cautious":
        return "Defer aggressive spend here until sell-through or margin quality improves."
    return "No immediate capital move is required right now."


def _build_next_action(
    risk_level: str,
    stockout_probability: float,
    stock_buffer: float,
    stock_policy_class: str,
    cash_priority_tier: str,
) -> str:
    if cash_priority_tier == "protect-now":
        return "Protect this SKU first and confirm inbound coverage today."
    if cash_priority_tier == "invest-next" and stock_policy_class == "protect":
        return "Commit replenishment this cycle and keep this core line fully covered."
    if risk_level == "critical":
        return "Reorder immediately and confirm inbound coverage today."
    if risk_level == "high":
        return "Reorder within 48 hours and watch supplier commitments closely."
    if risk_level == "medium":
        return "Keep this SKU on the reorder watchlist this week."
    if stock_buffer > 0 and stockout_probability < 0.15:
        return "Safe to defer purchase and focus on faster-moving exposure."
    if cash_priority_tier == "defer" or stock_policy_class == "cautious":
        return "Defer aggressive buying and use capital on stronger-protection lines first."
    return "Maintain current plan and continue monitoring demand."


def build_sku_forecasts(
    products,
    paid_sales,
    purchase_orders,
    inventory_movements,
    cycle_counts,
    planning_days: int,
    limit: int,
    low_stock_threshold: float,
    anchor_date,
    supplier_execution_baseline,
):
    """Build per-SKU demand, risk, and explainability outputs."""
    inbound_by_product = build_inbound_by_product(purchase_orders)
    lead_times = build_lead_times(purchase_orders, products)
    stock_integrity = build_stock_integrity_maps(products, inventory_movements, cycle_counts)
    history = build_daily_product_series(products, paid_sales, anchor_date)

    sku_forecasts = []
    for product in products:
        product_id = product.get("id")
        product_key = str(product_id)
        category = product.get("category") or "General"
        demand_series = history["seriesByProduct"].get(product_key, [0.0] * DEFAULT_HISTORY_DAYS)
        category_series_total = history["seriesByCategory"].get(category, [0.0] * DEFAULT_HISTORY_DAYS)
        category_count = max(1, history["categoryCounts"].get(category, 1))
        category_series = [value / category_count for value in category_series_total]

        observed_days = sum(1 for value in demand_series if value > 0)
        total_units = sum(demand_series)
        recent_window = demand_series[-14:]
        previous_window = demand_series[-28:-14] if len(demand_series) >= 28 else demand_series[:-14]
        recent_average = safe_mean(recent_window)
        previous_average = safe_mean(previous_window)

        holdout = backtest_series(demand_series, min(7, max(2, DEFAULT_HISTORY_DAYS // 6)))
        daily_model = damped_holt_forecast(demand_series, planning_days)
        category_model = damped_holt_forecast(category_series, planning_days)
        weekday_profile = history["weekdayProfiles"].get(product_key, [1.0] * 7)
        category_weekday_profile = history["categoryWeekdayProfiles"].get(category, [1.0] * 7)
        category_blend = _get_category_fallback_blend(observed_days, total_units)
        demand_pattern = _get_demand_pattern(observed_days, total_units)

        future_daily_units = []
        future_daily_lower = []
        future_daily_upper = []
        residual_scale = max(0.35, safe_std(daily_model["residuals"]))
        running_date = start_of_day(anchor_date)
        non_zero_values = [value for value in demand_series if value > 0]
        average_interval = DEFAULT_HISTORY_DAYS / max(1, observed_days)
        intermittent_daily = safe_mean(non_zero_values) / max(1.0, average_interval) if non_zero_values else 0.0

        for step, base_value in enumerate(daily_model["values"], start=1):
            future_date = running_date + timedelta(days=step)
            seasonality_profile = weekday_profile if observed_days >= 4 else category_weekday_profile
            seasonality = seasonality_profile[get_weekday_index(future_date)]
            projected = max(0.0, base_value * seasonality)
            category_projected = max(0.0, category_model["values"][step - 1] * category_weekday_profile[get_weekday_index(future_date)])
            if category_blend > 0:
                projected = projected * (1 - category_blend) + category_projected * category_blend
            if demand_pattern == "intermittent":
                projected = projected * (1 - INTERMITTENT_BLEND) + intermittent_daily * INTERMITTENT_BLEND
            interval = 1.28 * residual_scale * math.sqrt(step)
            future_daily_units.append(projected)
            future_daily_lower.append(max(0.0, projected - interval))
            future_daily_upper.append(projected + interval)

        base_forecast_units = sum(daily_model["values"])
        forecast_units = sum(future_daily_units)
        forecast_lower = sum(future_daily_lower)
        forecast_upper = sum(future_daily_upper)
        forecast_daily_units = forecast_units / planning_days if planning_days else 0.0
        stock = max(0.0, to_number(product.get("stock")))
        inbound_units = max(0.0, inbound_by_product.get(product_key, 0.0))
        integrity = stock_integrity.get(
            product_key,
            {
                "movementEvents": 0,
                "negativeAdjustmentUnits": 0.0,
                "cycleVarianceUnits": 0.0,
                "cycleVarianceEvents": 0,
                "integrityRisk": 0.0,
            },
        )
        supplier_execution = supplier_execution_baseline.get(
            normalize_supplier_name(product.get("supplier")),
            {
                "delayRiskScore": 0.0,
                "serviceScore": 100.0,
                "fillRate": None,
                "onTimeRate": None,
                "lateOpenOrders": 0,
                "openOrders": 0,
            },
        )

        lead = lead_times.get(product_key, {"mean": DEFAULT_LEAD_TIME_DAYS, "p90": DEFAULT_LEAD_TIME_DAYS, "samples": 0})
        lead_mean = max(1.0, to_number(lead["mean"], DEFAULT_LEAD_TIME_DAYS))
        lead_p90 = max(lead_mean, to_number(lead["p90"], DEFAULT_LEAD_TIME_DAYS))
        demand_sigma = safe_std(recent_window if any(recent_window) else demand_series)
        lead_samples = int(lead.get("samples", 0))
        lead_time_std = max(0.6, (lead_p90 - lead_mean) / 1.2816) if lead_p90 > lead_mean else 0.6

        demand_during_lead = forecast_daily_units * lead_mean
        demand_std_during_lead = math.sqrt(
            max(0.01, (demand_sigma**2) * lead_mean + ((forecast_daily_units or 0.1) ** 2) * (lead_time_std**2))
        )
        available_units = stock + inbound_units
        supplier_delay_risk = clamp(to_number(supplier_execution.get("delayRiskScore")) / 100.0, 0.0, 1.0)
        integrity_risk = to_number(integrity.get("integrityRisk"))

        data_quality_penalty = integrity_risk * CONFIDENCE_INTEGRITY_PENALTY
        data_quality_penalty += supplier_delay_risk * CONFIDENCE_SUPPLIER_PENALTY
        data_quality_penalty += category_blend * 8.0
        if lead_samples <= 0:
            data_quality_penalty += 3.0

        confidence_breakdown = build_confidence_breakdown(
            history_points=DEFAULT_HISTORY_DAYS,
            observed_points=observed_days,
            holdout_wape=holdout["wape"],
            horizon=min(14, planning_days),
            lead_samples=lead_samples,
            data_quality_penalty=data_quality_penalty,
        )
        confidence_score = int(confidence_breakdown["total"])
        trend_direction = get_trend_direction(recent_average, previous_average)
        gross_margin_pct = ((product["price"] - product["unitCost"]) / product["price"]) * 100.0 if product["price"] > 0 else 0.0
        velocity_band = _get_velocity_band(forecast_daily_units, demand_pattern, observed_days)
        stock_policy_class = _build_stock_policy_class(
            velocity_band,
            trend_direction,
            gross_margin_pct,
            confidence_score,
            demand_pattern,
        )
        service_level = _get_service_level_for_policy(stock_policy_class)
        safety_stock = to_number(service_level["z"], DEFAULT_SERVICE_LEVEL_Z) * demand_std_during_lead if forecast_daily_units > 0 else 0.0
        reorder_point = demand_during_lead + safety_stock
        recommended_order_qty = max(0, int(math.ceil(reorder_point + forecast_units - available_units)))
        days_cover = stock / forecast_daily_units if forecast_daily_units > 0 else None
        stockout_probability = compute_stockout_probability(demand_during_lead, demand_std_during_lead, available_units)
        stockout_probability = clamp(
            stockout_probability + integrity_risk * STOCKOUT_INTEGRITY_ADJUSTMENT + supplier_delay_risk * STOCKOUT_SUPPLIER_ADJUSTMENT,
            0.0,
            1.0,
        )
        risk_level = build_risk_level(stockout_probability, days_cover, lead_p90, recommended_order_qty, stock, inbound_units)
        stock_buffer = available_units - reorder_point
        forecast_revenue = forecast_units * product["price"]
        order_spend = recommended_order_qty * product["unitCost"]
        cash_priority_score = _build_cash_priority_score(
            risk_level,
            stockout_probability,
            gross_margin_pct,
            forecast_revenue,
            supplier_delay_risk,
            confidence_score,
            stock_policy_class,
            demand_pattern,
            order_spend,
        )
        cash_priority_tier = _get_cash_priority_tier(cash_priority_score)
        policy_reason = _build_policy_reason(
            stock_policy_class,
            velocity_band,
            trend_direction,
            gross_margin_pct,
            confidence_score,
            demand_pattern,
        )
        cash_priority_reason = _build_cash_priority_reason(
            cash_priority_tier,
            order_spend,
            stock_policy_class,
            forecast_revenue,
        )
        data_quality_warnings = _build_data_quality_warnings(observed_days, lead_samples, integrity_risk, category_blend)
        top_drivers = _build_top_drivers(
            stockout_probability=stockout_probability,
            trend_direction=trend_direction,
            supplier_delay_risk=supplier_delay_risk,
            integrity_risk=integrity_risk,
            inbound_units=inbound_units,
            category_blend=category_blend,
            stock_policy_class=stock_policy_class,
            cash_priority_tier=cash_priority_tier,
        )

        sku_forecasts.append(
            {
                "id": product.get("id"),
                "name": product.get("name"),
                "sku": product.get("sku"),
                "category": category,
                "supplier": product.get("supplier"),
                "currentStock": stock,
                "lowStockThreshold": max(1.0, to_number(low_stock_threshold, 10.0)),
                "inboundUnits": round_value(inbound_units, 1),
                "leadTimeDays": round_value(lead_mean, 1),
                "leadTimeP90Days": round_value(lead_p90, 1),
                "leadTimeSamples": lead_samples,
                "historicalUnits": round_value(total_units, 0),
                "observedSellingDays": observed_days,
                "forecastUnits": round_value(forecast_units, 1),
                "forecastUnitsLower": round_value(forecast_lower, 1),
                "forecastUnitsUpper": round_value(forecast_upper, 1),
                "forecastDailyUnits": round_value(forecast_daily_units, 2),
                "forecastRevenue": round_value(forecast_units * product["price"]),
                "forecastRevenueLower": round_value(forecast_lower * product["price"]),
                "forecastRevenueUpper": round_value(forecast_upper * product["price"]),
                "confidenceScore": confidence_score,
                "confidenceBreakdown": confidence_breakdown,
                "holdoutWape": holdout["wape"],
                "trendDirection": trend_direction,
                "demandPattern": demand_pattern,
                "velocityBand": velocity_band,
                "safetyStock": round_value(safety_stock, 1),
                "serviceLevelTargetPct": to_number(service_level["targetPct"]),
                "serviceLevelZ": round_value(to_number(service_level["z"]), 2),
                "stockPolicyClass": stock_policy_class,
                "policyReason": policy_reason,
                "reorderPoint": round_value(reorder_point, 1),
                "recommendedOrderQty": recommended_order_qty,
                "orderSpend": round_value(order_spend),
                "daysCover": None if days_cover is None else round_value(days_cover, 1),
                "lastSoldAt": iso(history["lastSaleAtByProduct"].get(product_key)),
                "riskLevel": risk_level,
                "urgency": "immediate" if risk_level == "critical" else "this_week" if risk_level == "high" else "watch" if risk_level == "medium" else "stable",
                "stockoutProbability": round_value(stockout_probability, 4),
                "cashPriorityScore": cash_priority_score,
                "cashPriorityTier": cash_priority_tier,
                "cashPriorityReason": cash_priority_reason,
                "reason": build_risk_reason(
                    product.get("name"),
                    risk_level,
                    days_cover,
                    stockout_probability,
                    lead_p90,
                    inbound_units,
                    trend_direction,
                ),
                "topDrivers": top_drivers,
                "nextAction": _build_next_action(
                    risk_level,
                    stockout_probability,
                    stock_buffer,
                    stock_policy_class,
                    cash_priority_tier,
                ),
                "whyNow": top_drivers[0] if top_drivers else build_risk_reason(
                    product.get("name"),
                    risk_level,
                    days_cover,
                    stockout_probability,
                    lead_p90,
                    inbound_units,
                    trend_direction,
                ),
                "dataQualityWarnings": data_quality_warnings,
                "unitPrice": round_value(product["price"]),
                "unitCost": round_value(product["unitCost"]),
                "grossMarginPct": round_value(gross_margin_pct, 1),
                "stockBuffer": round_value(stock_buffer, 1),
                "movementEvents": int(integrity.get("movementEvents", 0)),
                "negativeAdjustmentUnits": round_value(integrity.get("negativeAdjustmentUnits"), 1),
                "cycleVarianceUnits": round_value(integrity.get("cycleVarianceUnits"), 1),
                "cycleVarianceEvents": int(integrity.get("cycleVarianceEvents", 0)),
                "stockIntegrityRisk": round_value(integrity_risk, 4),
                "supplierDelayRiskScore": round_value(to_number(supplier_execution.get("delayRiskScore")), 1),
                "supplierServiceScore": round_value(to_number(supplier_execution.get("serviceScore")), 0),
                "supplierFillRate": None if supplier_execution.get("fillRate") is None else round_value(supplier_execution.get("fillRate"), 1),
                "supplierOnTimeRate": None if supplier_execution.get("onTimeRate") is None else round_value(supplier_execution.get("onTimeRate"), 1),
                "supplierLateCommitments": int(to_number(supplier_execution.get("lateOpenOrders"))),
                "supplierOpenOrders": int(to_number(supplier_execution.get("openOrders"))),
                "forecastDecomposition": {
                    "baseForecastUnits": round_value(base_forecast_units, 1),
                    "seasonalityLiftPct": round_value(
                        ((forecast_units - max(0.0, base_forecast_units)) / max(1.0, base_forecast_units)) * 100.0,
                        1,
                    ),
                    "categoryFallbackBlend": round_value(category_blend, 4),
                    "supplierRiskAdjustment": round_value(supplier_delay_risk, 4),
                    "serviceLevelTargetPct": to_number(service_level["targetPct"]),
                    "finalForecastUnits": round_value(forecast_units, 1),
                },
            }
        )

    risk_priority = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    sku_forecasts.sort(
        key=lambda item: (
            risk_priority.get(item["riskLevel"], 9),
            -to_number(item.get("cashPriorityScore")),
            -to_number(item["stockoutProbability"]),
            -to_number(item["recommendedOrderQty"]),
            -to_number(item["forecastRevenue"]),
            -to_number(item["confidenceScore"]),
        )
    )
    return sku_forecasts[:limit]
