"""Payload assembly for the operational ML engine."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from time import perf_counter

from .anomaly import build_anomaly_outputs
from .constants import (
    DEFAULT_HISTORY_DAYS,
    DEFAULT_LOW_STOCK_THRESHOLD,
    ENGINE_VERSION,
    MODEL_ENGINE,
    MODEL_FAMILY,
    MODEL_METHOD,
    PAID_SALE_STATUSES,
    PROMOTION_MAX_STOCKOUT_PROBABILITY,
    PROMOTION_MIN_CONFIDENCE,
    PROMOTION_MIN_MARGIN_PCT,
    SCORING_VERSION,
)
from .dates import iso, start_of_day
from .forecasting import build_aggregate_periods
from .inventory_risk import build_sku_forecasts
from .normalization import (
    build_cycle_counts,
    build_entities,
    build_inventory_movements,
    build_products,
    build_purchase_orders,
    build_sales,
)
from .supplier import build_supplier_execution_baseline, build_supplier_signals
from .utils import clamp, round_value, to_number
from .validation import validate_payload

logger = logging.getLogger(__name__)


def build_stockout_risks(sku_forecasts):
    return [
        {
            "id": item["id"],
            "name": item["name"],
            "sku": item["sku"],
            "supplier": item["supplier"],
            "riskLevel": item["riskLevel"],
            "stockPolicyClass": item.get("stockPolicyClass") or "standard",
            "serviceLevelTargetPct": to_number(item.get("serviceLevelTargetPct")),
            "cashPriorityScore": to_number(item.get("cashPriorityScore")),
            "cashPriorityTier": item.get("cashPriorityTier") or "watch",
            "cashPriorityReason": item.get("cashPriorityReason"),
            "currentStock": item["currentStock"],
            "inboundUnits": item["inboundUnits"],
            "forecastRevenue": to_number(item.get("forecastRevenue")),
            "projectedStockoutDays": item["daysCover"],
            "recommendedOrderQty": item["recommendedOrderQty"],
            "orderSpend": to_number(item.get("orderSpend")),
            "confidenceScore": item["confidenceScore"],
            "stockoutProbability": item["stockoutProbability"],
            "reason": item["reason"],
            "topDrivers": item.get("topDrivers") or [],
            "nextAction": item.get("nextAction"),
        }
        for item in sku_forecasts
        if item["riskLevel"] in ("critical", "high", "medium")
    ][:6]


def build_promotion_candidates(sku_forecasts):
    opportunities = []
    for item in sku_forecasts:
        stock_buffer = to_number(item["stockBuffer"])
        gross_margin = to_number(item["grossMarginPct"])
        confidence = to_number(item["confidenceScore"])
        probability = to_number(item["stockoutProbability"])
        opportunity_score = (
            max(0.0, confidence - 45.0) * 0.45
            + max(0.0, gross_margin - PROMOTION_MIN_MARGIN_PCT) * 0.4
            + max(0.0, stock_buffer) * 0.25
            + (12.0 if item["trendDirection"] == "rising" else 6.0 if item["trendDirection"] == "stable" else 0.0)
            + max(0.0, (PROMOTION_MAX_STOCKOUT_PROBABILITY - probability) * 100.0) * 0.2
        )
        if (
            item.get("stockPolicyClass") == "protect"
            or confidence < PROMOTION_MIN_CONFIDENCE
            or gross_margin < PROMOTION_MIN_MARGIN_PCT
            or stock_buffer <= 0
            or probability > PROMOTION_MAX_STOCKOUT_PROBABILITY
        ):
            continue
        if item["trendDirection"] not in ("rising", "stable"):
            continue
        opportunities.append(
            {
                "id": item["id"],
                "name": item["name"],
                "sku": item["sku"],
                "category": item["category"],
                "supplier": item["supplier"],
                "stockPolicyClass": item.get("stockPolicyClass") or "standard",
                "trendDirection": item["trendDirection"],
                "currentStock": item["currentStock"],
                "reorderPoint": item["reorderPoint"],
                "stockBuffer": round_value(stock_buffer, 1),
                "forecastRevenue": item["forecastRevenue"],
                "confidenceScore": item["confidenceScore"],
                "grossMarginPct": round_value(gross_margin, 1),
                "stockoutProbability": round_value(probability, 4),
                "opportunityScore": round_value(opportunity_score, 1),
                "nextAction": item.get("nextAction") or "Promote carefully while stock buffer remains healthy.",
            }
        )
    opportunities.sort(key=lambda item: (-to_number(item["opportunityScore"]), -to_number(item["forecastRevenue"])))
    return opportunities[:6]


def build_data_foundation(
    products,
    sales,
    purchase_orders,
    inventory_movements,
    cycle_counts,
    customers,
    suppliers,
    users,
    anchor_date,
):
    paid_sales = [sale for sale in sales if str(sale.get("status") or "").strip().lower() in PAID_SALE_STATUSES]
    sale_items = [item for sale in sales for item in sale.get("items") or []]
    named_customer_sales = [
        sale
        for sale in paid_sales
        if str(sale.get("customer") or "").strip().lower() not in ("", "walk-in", "walk-in customer", "walk in", "guest", "anonymous")
    ]
    earliest_dates = [
        entry
        for entry in [
            *(sale.get("date") for sale in sales),
            *(movement.get("createdAt") for movement in inventory_movements),
            *(order.get("createdAt") for order in purchase_orders),
        ]
        if entry is not None
    ]
    earliest_date = min(earliest_dates) if earliest_dates else anchor_date
    history_days = max(1, int((start_of_day(anchor_date) - start_of_day(earliest_date)).days) + 1)

    movement_product_ids = {str(movement.get("productId")) for movement in inventory_movements if movement.get("productId") is not None}
    cycle_count_product_ids = {
        str(item.get("productId"))
        for count in cycle_counts
        for item in (count.get("items") or [])
        if item.get("productId") is not None
    }
    received_product_ids = {
        str(item.get("productId"))
        for order in purchase_orders
        if str(order.get("status") or "").strip().lower() == "received"
        for item in (order.get("items") or [])
        if item.get("productId") is not None and to_number(item.get("qtyReceived")) > 0
    }

    paid_sales_rate = (len(paid_sales) / len(sales) * 100.0) if sales else 0.0
    named_customer_rate = (len(named_customer_sales) / len(paid_sales) * 100.0) if paid_sales else 0.0
    movement_coverage_rate = (len(movement_product_ids) / len(products) * 100.0) if products else 0.0
    cycle_count_coverage_rate = (len(cycle_count_product_ids) / len(products) * 100.0) if products else 0.0
    lead_time_coverage_rate = (len(received_product_ids) / len(products) * 100.0) if products else 0.0

    richness_components = [
        clamp(history_days / 180.0, 0.0, 1.0) * 28.0,
        clamp(len(sales) / 250.0, 0.0, 1.0) * 18.0,
        clamp(len(sale_items) / 800.0, 0.0, 1.0) * 16.0,
        clamp(movement_coverage_rate / 100.0, 0.0, 1.0) * 14.0,
        clamp(lead_time_coverage_rate / 100.0, 0.0, 1.0) * 10.0,
        clamp(cycle_count_coverage_rate / 100.0, 0.0, 1.0) * 8.0,
        clamp(named_customer_rate / 100.0, 0.0, 1.0) * 6.0,
    ]
    richness_score = int(round(clamp(sum(richness_components), 12.0, 100.0)))

    warnings = []
    if history_days < 90:
        warnings.append(f"Only {history_days} day(s) of operating history are available to the model.")
    if lead_time_coverage_rate < 40:
        warnings.append("Lead-time coverage is still thin across the product catalog.")
    if cycle_count_coverage_rate < 20:
        warnings.append("Cycle-count coverage is low, so stock integrity confidence is limited.")
    if named_customer_rate < 35:
        warnings.append("Named-customer coverage is limited, which reduces relationship-level demand context.")

    if richness_score >= 72:
        narrative = "The model foundation is broad enough to support stronger demand, lead-time, and stock-risk signals."
    elif richness_score >= 48:
        narrative = "The model foundation is usable, but it still needs more history depth and operational coverage to tighten confidence."
    else:
        narrative = "The model foundation is still thin, so forecast intervals and confidence should be treated cautiously."

    return {
        "richnessScore": richness_score,
        "narrative": narrative,
        "historyDays": history_days,
        "qualityWarnings": warnings[:6],
        "entityCounts": {
            "products": len(products),
            "sales": len(sales),
            "paidSales": len(paid_sales),
            "saleItems": len(sale_items),
            "purchaseOrders": len(purchase_orders),
            "inventoryMovements": len(inventory_movements),
            "cycleCounts": len(cycle_counts),
            "customers": len(customers),
            "suppliers": len(suppliers),
            "users": len(users),
        },
        "coverage": {
            "paidSalesRate": round_value(paid_sales_rate, 1),
            "namedCustomerRate": round_value(named_customer_rate, 1),
            "movementCoverageRate": round_value(movement_coverage_rate, 1),
            "cycleCountCoverageRate": round_value(cycle_count_coverage_rate, 1),
            "leadTimeCoverageRate": round_value(lead_time_coverage_rate, 1),
        },
    }


def summarize_sku_forecasts(sku_forecasts):
    return {
        "criticalCount": sum(1 for item in sku_forecasts if item["riskLevel"] == "critical"),
        "highRiskCount": sum(1 for item in sku_forecasts if item["riskLevel"] == "high"),
        "projectedRevenue": round_value(sum(to_number(item["forecastRevenue"]) for item in sku_forecasts)),
        "recommendedOrderUnits": int(round(sum(to_number(item["recommendedOrderQty"]) for item in sku_forecasts))),
        "averageConfidenceScore": int(round(sum(to_number(item["confidenceScore"]) for item in sku_forecasts) / len(sku_forecasts))) if sku_forecasts else 0,
    }


def build_model_summary(forecast, anomaly_output, stockout_risks, promotion_candidates, data_foundation, supplier_signals):
    overview = forecast["overview"]
    sku_forecasts = forecast["skuForecasts"]
    average_sku_confidence = int(round(sum(to_number(item["confidenceScore"]) for item in sku_forecasts) / len(sku_forecasts))) if sku_forecasts else 0
    top_capital_priority = (
        sorted(
            sku_forecasts,
            key=lambda item: (-to_number(item.get("cashPriorityScore")), -to_number(item.get("stockoutProbability"))),
        )[0]
        if sku_forecasts
        else None
    )
    return {
        "confidenceScore": to_number(overview.get("confidenceScore")),
        "averageSkuConfidence": average_sku_confidence,
        "revenueWape": overview.get("revenueWape"),
        "ordersWape": overview.get("ordersWape"),
        "anomalyTone": anomaly_output["summary"].get("statusTone"),
        "anomalyCount": len(anomaly_output["alerts"]),
        "stockoutRiskCount": len(stockout_risks),
        "promotionOpportunityCount": len(promotion_candidates),
        "supplierRiskCount": len([item for item in supplier_signals if item.get("statusTone") != "success"]),
        "supplierPressureCount": len([item for item in supplier_signals if item.get("statusTone") != "success"]),
        "dataRichnessScore": to_number(data_foundation.get("richnessScore")),
        "topStockoutRisk": stockout_risks[0] if stockout_risks else None,
        "topPromotionCandidate": promotion_candidates[0] if promotion_candidates else None,
        "topSupplierSignal": supplier_signals[0] if supplier_signals else None,
        "topCapitalPriority": top_capital_priority,
    }


def build_portfolio_summary(sku_forecasts, stockout_risks, promotion_candidates, supplier_signals):
    exposed_revenue = sum(to_number(item.get("forecastRevenue")) for item in stockout_risks)
    recommended_units = sum(to_number(item.get("recommendedOrderQty")) for item in sku_forecasts)
    recommended_spend = sum(to_number(item.get("recommendedOrderQty")) * to_number(item.get("unitCost")) for item in sku_forecasts)
    high_priority_order_spend = sum(
        to_number(item.get("orderSpend"))
        for item in sku_forecasts
        if str(item.get("cashPriorityTier") or "") in {"protect-now", "invest-next"}
    )
    protected_revenue = sum(
        to_number(item.get("forecastRevenue"))
        for item in sku_forecasts
        if str(item.get("stockPolicyClass") or "") == "protect"
    )
    deferred_sku_count = sum(1 for item in sku_forecasts if str(item.get("cashPriorityTier") or "") == "defer")
    protected_margin = sum(to_number(item.get("forecastRevenue")) * (to_number(item.get("grossMarginPct")) / 100.0) for item in promotion_candidates)
    return {
        "exposedRevenue": round_value(exposed_revenue),
        "recommendedOrderUnits": int(round(recommended_units)),
        "recommendedOrderSpend": round_value(recommended_spend),
        "highPriorityOrderSpend": round_value(high_priority_order_spend),
        "protectedRevenue": round_value(protected_revenue),
        "deferredSkuCount": deferred_sku_count,
        "promotionRevenuePool": round_value(sum(to_number(item.get("forecastRevenue")) for item in promotion_candidates)),
        "promotionMarginPool": round_value(protected_margin),
        "supplierPressureCount": len([item for item in supplier_signals if item.get("statusTone") != "success"]),
    }


def build_payload(raw_payload):
    """Build the full operational ML payload from a validated raw request."""
    started_at = perf_counter()
    options, context = validate_payload(raw_payload)
    latest_observed_at = context.get("latestObservedAt")
    if hasattr(latest_observed_at, "isoformat"):
        latest_observed_at = latest_observed_at
    else:
        latest_observed_at = None

    latest_observed_at = latest_observed_at or datetime.now(timezone.utc)

    logger.info(
        "Building ML payload for range=%s horizon=%s with %s products, %s sales, %s purchase orders",
        options["range"],
        options["horizon"],
        len(context.get("products") or []),
        len(context.get("sales") or []),
        len(context.get("purchaseOrders") or []),
    )

    timings = {}

    t0 = perf_counter()
    products = build_products(context.get("products"))
    sales = build_sales(context.get("sales"))
    purchase_orders = build_purchase_orders(context.get("purchaseOrders"))
    inventory_movements = build_inventory_movements(context.get("inventoryMovements"))
    cycle_counts = build_cycle_counts(context.get("cycleCounts"))
    customers = build_entities(context.get("customers"), "customer")
    suppliers = build_entities(context.get("suppliers"), "supplier")
    users = build_entities(context.get("users"), "user")
    timings["normalization"] = int(round((perf_counter() - t0) * 1000))

    paid_sales = [sale for sale in sales if str(sale["status"] or "").strip().lower() in PAID_SALE_STATUSES]

    t0 = perf_counter()
    aggregate = build_aggregate_periods(options["range"], options["horizon"], paid_sales, latest_observed_at)
    timings["aggregateForecast"] = int(round((perf_counter() - t0) * 1000))

    low_stock_threshold = to_number((context.get("settings") or {}).get("lowStockThreshold"), DEFAULT_LOW_STOCK_THRESHOLD)
    planning_days = int(aggregate["overview"]["planningDays"])

    t0 = perf_counter()
    supplier_execution_baseline = build_supplier_execution_baseline(purchase_orders, latest_observed_at)
    sku_forecasts = build_sku_forecasts(
        products,
        paid_sales,
        purchase_orders,
        inventory_movements,
        cycle_counts,
        planning_days,
        options["limit"],
        low_stock_threshold,
        latest_observed_at,
        supplier_execution_baseline,
    )
    timings["skuForecasts"] = int(round((perf_counter() - t0) * 1000))

    restock_recommendations = [
        item
        for item in sku_forecasts
        if item["recommendedOrderQty"] > 0 or item["riskLevel"] in ("critical", "high", "medium")
    ][: options["limit"]]

    t0 = perf_counter()
    anomaly_output = build_anomaly_outputs(sales, latest_observed_at)
    stockout_risks = build_stockout_risks(sku_forecasts)
    promotion_candidates = build_promotion_candidates(sku_forecasts)
    supplier_signals = build_supplier_signals(supplier_execution_baseline, sku_forecasts, options["limit"])
    data_foundation = build_data_foundation(
        products,
        sales,
        purchase_orders,
        inventory_movements,
        cycle_counts,
        customers,
        suppliers,
        users,
        latest_observed_at,
    )
    timings["intelligence"] = int(round((perf_counter() - t0) * 1000))

    overview = dict(aggregate["overview"])
    overview["skuSummary"] = summarize_sku_forecasts(sku_forecasts)
    overview["dataRichnessScore"] = to_number(data_foundation.get("richnessScore"))
    overview["supplierSignalCount"] = len(supplier_signals)
    overview["leadSupplierRisk"] = supplier_signals[0]["supplier"] if supplier_signals else None
    overview["qualityWarnings"] = data_foundation.get("qualityWarnings") or []

    forecast = {
        "generatedAt": iso(datetime.now(timezone.utc)),
        "generatedFromDataThrough": iso(latest_observed_at),
        "trainingWindowDays": DEFAULT_HISTORY_DAYS,
        "engine": MODEL_ENGINE,
        "engineVersion": ENGINE_VERSION,
        "scoringVersion": SCORING_VERSION,
        "modelFamily": MODEL_FAMILY,
        "method": MODEL_METHOD,
        "overview": overview,
        "periods": aggregate["periods"],
        "skuForecasts": sku_forecasts,
        "restockRecommendations": restock_recommendations,
        "anomalySummary": anomaly_output["summary"],
        "anomalyAlerts": anomaly_output["alerts"],
        "anomalySeries": anomaly_output["recentDailySeries"],
        "stockoutRisks": stockout_risks,
        "promotionCandidates": promotion_candidates,
        "supplierSignals": supplier_signals,
        "dataFoundation": data_foundation,
        "portfolioSummary": build_portfolio_summary(sku_forecasts, stockout_risks, promotion_candidates, supplier_signals),
        "runtime": {
            "optionsUsed": options,
            "stageTimingsMs": timings,
            "totalMs": int(round((perf_counter() - started_at) * 1000)),
        },
    }
    forecast["modelSummary"] = build_model_summary(
        forecast,
        anomaly_output,
        stockout_risks,
        promotion_candidates,
        data_foundation,
        supplier_signals,
    )

    logger.info(
        "Built ML payload with %s SKU forecasts, %s stockout risks, %s promotion candidates in %sms",
        len(sku_forecasts),
        len(stockout_risks),
        len(promotion_candidates),
        forecast["runtime"]["totalMs"],
    )

    return forecast
