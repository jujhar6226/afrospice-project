"""Supplier execution and lead-time intelligence."""

from __future__ import annotations

from collections import defaultdict

from .constants import (
    CLOSED_PO_STATUSES,
    DEFAULT_LEAD_TIME_DAYS,
    SUPPLIER_DANGER_RISK,
    SUPPLIER_WARNING_RISK,
)
from .stats import percentile, safe_mean, safe_std
from .utils import clamp, round_value, to_number


def normalize_supplier_name(value) -> str:
    return str(value or "General Supplier").strip() or "General Supplier"


def build_inbound_by_product(purchase_orders):
    inbound = defaultdict(float)
    for order in purchase_orders:
        if str(order["status"]).strip().lower() in CLOSED_PO_STATUSES:
            continue
        for item in order["items"]:
            product_id = item.get("productId")
            if product_id is None:
                continue
            open_units = max(0.0, to_number(item.get("qtyOrdered")) - to_number(item.get("qtyReceived")))
            if open_units > 0:
                inbound[str(product_id)] += open_units
    return inbound


def build_lead_times(purchase_orders, products):
    product_leads = defaultdict(list)
    supplier_leads = defaultdict(list)
    supplier_by_product = {
        str(product["id"]): normalize_supplier_name(product.get("supplier"))
        for product in products
        if product.get("id") is not None
    }

    for order in purchase_orders:
        if str(order["status"]).strip().lower() != "received":
            continue

        sent_at = order.get("sentAt") or order.get("createdAt")
        received_at = order.get("receivedAt") or order.get("updatedAt")
        if not sent_at or not received_at or received_at <= sent_at:
            continue

        lead_days = max(1.0, (received_at - sent_at).total_seconds() / 86400.0)
        supplier = normalize_supplier_name(order.get("supplier"))
        supplier_leads[supplier].append(lead_days)

        for item in order["items"]:
            product_id = item.get("productId")
            qty_received = to_number(item.get("qtyReceived"))
            if product_id is not None and qty_received > 0:
                product_leads[str(product_id)].append(lead_days)

    default_samples = [value for values in supplier_leads.values() for value in values]
    default_mean = round_value(safe_mean(default_samples) or DEFAULT_LEAD_TIME_DAYS, 1)
    default_p90 = round_value(percentile(default_samples, 0.9) or DEFAULT_LEAD_TIME_DAYS, 1)

    result = {}
    for product in products:
        product_id = str(product.get("id"))
        supplier = supplier_by_product.get(product_id) or "General Supplier"
        samples = product_leads.get(product_id) or supplier_leads.get(supplier) or []
        result[product_id] = {
            "mean": round_value(safe_mean(samples) or default_mean, 1),
            "p90": round_value(percentile(samples, 0.9) or default_p90, 1),
            "samples": len(samples),
        }

    return result


def build_supplier_execution_baseline(purchase_orders, anchor_date):
    """Build historical supplier execution signals from purchase order outcomes."""
    supplier_map = defaultdict(
        lambda: {
            "supplier": "General Supplier",
            "orderCount": 0,
            "receivedOrders": 0,
            "openOrders": 0,
            "lateOpenOrders": 0,
            "lateReceipts": 0,
            "onTimeReceipts": 0,
            "unitsOrdered": 0.0,
            "unitsReceived": 0.0,
            "openUnits": 0.0,
            "commitmentValue": 0.0,
            "openCommitmentValue": 0.0,
            "leadSamples": [],
        }
    )

    for order in purchase_orders:
        supplier = normalize_supplier_name(order.get("supplier"))
        entry = supplier_map[supplier]
        entry["supplier"] = supplier
        entry["orderCount"] += 1

        items = order.get("items") or []
        ordered_units = sum(max(0.0, to_number(item.get("qtyOrdered"))) for item in items)
        received_units = sum(max(0.0, to_number(item.get("qtyReceived"))) for item in items)
        open_units = max(0.0, ordered_units - received_units)
        commitment_value = sum(
            max(0.0, to_number(item.get("qtyOrdered"))) * max(0.0, to_number(item.get("unitCost")))
            for item in items
        )
        open_commitment_value = sum(
            max(0.0, max(0.0, to_number(item.get("qtyOrdered")) - to_number(item.get("qtyReceived"))))
            * max(0.0, to_number(item.get("unitCost")))
            for item in items
        )

        entry["unitsOrdered"] += ordered_units
        entry["unitsReceived"] += received_units
        entry["openUnits"] += open_units
        entry["commitmentValue"] += commitment_value
        entry["openCommitmentValue"] += open_commitment_value

        status = str(order.get("status") or "").strip().lower()
        expected_at = order.get("expectedDate")
        sent_at = order.get("sentAt") or order.get("createdAt")
        received_at = order.get("receivedAt") or (order.get("updatedAt") if status == "received" else None)
        is_received = status == "received" or (ordered_units > 0 and received_units >= ordered_units)

        if is_received:
            entry["receivedOrders"] += 1
            if expected_at and received_at:
                if received_at <= expected_at:
                    entry["onTimeReceipts"] += 1
                else:
                    entry["lateReceipts"] += 1

            if sent_at and received_at and received_at > sent_at:
                lead_days = max(1.0, (received_at - sent_at).total_seconds() / 86400.0)
                entry["leadSamples"].append(lead_days)
        else:
            if open_units > 0:
                entry["openOrders"] += 1
            if expected_at and expected_at < anchor_date:
                entry["lateOpenOrders"] += 1

    baseline = {}
    for supplier, entry in supplier_map.items():
        fill_rate = (entry["unitsReceived"] / entry["unitsOrdered"]) * 100.0 if entry["unitsOrdered"] > 0 else None
        on_time_rate = (entry["onTimeReceipts"] / entry["receivedOrders"]) * 100.0 if entry["receivedOrders"] > 0 else None
        average_lead_time = safe_mean(entry["leadSamples"]) if entry["leadSamples"] else None
        lead_time_p90 = percentile(entry["leadSamples"], 0.9) if entry["leadSamples"] else None
        lead_time_variability = safe_std(entry["leadSamples"]) if entry["leadSamples"] else 0.0
        open_pressure = clamp(entry["openUnits"] / max(1.0, entry["unitsOrdered"]), 0.0, 1.0)
        delay_risk_score = clamp(
            entry["lateOpenOrders"] * 17.0
            + entry["lateReceipts"] * 11.0
            + (max(0.0, 90.0 - fill_rate) * 0.55 if fill_rate is not None else (8.0 if entry["openOrders"] > 0 else 0.0))
            + (max(0.0, 92.0 - on_time_rate) * 0.4 if on_time_rate is not None else 0.0)
            + lead_time_variability * 5.5
            + open_pressure * 18.0,
            0.0,
            100.0,
        )
        service_score = round_value(clamp(100.0 - delay_risk_score * 0.82, 2.0, 100.0), 0)

        baseline[supplier] = {
            "supplier": supplier,
            "orderCount": entry["orderCount"],
            "receivedOrders": entry["receivedOrders"],
            "openOrders": entry["openOrders"],
            "lateOpenOrders": entry["lateOpenOrders"],
            "lateReceipts": entry["lateReceipts"],
            "unitsOrdered": round_value(entry["unitsOrdered"], 1),
            "unitsReceived": round_value(entry["unitsReceived"], 1),
            "openUnits": round_value(entry["openUnits"], 1),
            "commitmentValue": round_value(entry["commitmentValue"]),
            "openCommitmentValue": round_value(entry["openCommitmentValue"]),
            "fillRate": None if fill_rate is None else round_value(fill_rate, 1),
            "onTimeRate": None if on_time_rate is None else round_value(on_time_rate, 1),
            "averageLeadTimeDays": None if average_lead_time is None else round_value(average_lead_time, 1),
            "leadTimeP90Days": None if lead_time_p90 is None else round_value(lead_time_p90, 1),
            "leadTimeVariabilityDays": round_value(lead_time_variability, 2),
            "delayRiskScore": round_value(delay_risk_score, 1),
            "serviceScore": service_score,
        }

    return baseline


def get_supplier_signal_tone(weighted_risk_score: float) -> str:
    if weighted_risk_score >= SUPPLIER_DANGER_RISK:
        return "danger"
    if weighted_risk_score >= SUPPLIER_WARNING_RISK:
        return "warning"
    return "success"


def build_supplier_action(entry) -> str:
    supplier = entry.get("supplier") or "This supplier"
    weighted_risk_score = to_number(entry.get("weightedRiskScore"))
    if weighted_risk_score >= SUPPLIER_DANGER_RISK:
        return f"Escalate {supplier}, chase open commitments, and cover exposed SKUs before the next demand window."
    if weighted_risk_score >= SUPPLIER_WARNING_RISK:
        return f"Monitor {supplier} closely and tighten reorder timing around its exposed SKUs."
    return f"{supplier} is stable enough to support the current replenishment plan."


def _build_supplier_top_drivers(baseline, exposed_skus, weighted_risk_score: float):
    drivers = []
    if to_number(baseline.get("lateOpenOrders")) > 0:
        drivers.append("Late open commitments are still unresolved.")
    if baseline.get("fillRate") is not None and to_number(baseline.get("fillRate")) < 90:
        drivers.append("Historical fill rate is below the desired service band.")
    if baseline.get("onTimeRate") is not None and to_number(baseline.get("onTimeRate")) < 92:
        drivers.append("On-time receipt reliability is under pressure.")
    if len(exposed_skus) > 0:
        drivers.append(f"{len(exposed_skus)} exposed SKU(s) currently depend on this supplier.")
    if weighted_risk_score >= SUPPLIER_DANGER_RISK and not drivers:
        drivers.append("Execution pressure is materially above the safe operating band.")
    return drivers[:4]


def build_supplier_signals(supplier_execution_baseline, sku_forecasts, limit: int):
    supplier_names = {
        normalize_supplier_name(item.get("supplier"))
        for item in sku_forecasts
        if normalize_supplier_name(item.get("supplier"))
    } | set(supplier_execution_baseline.keys())

    supplier_signals = []
    for supplier in supplier_names:
        baseline = supplier_execution_baseline.get(
            supplier,
            {
                "supplier": supplier,
                "orderCount": 0,
                "receivedOrders": 0,
                "openOrders": 0,
                "lateOpenOrders": 0,
                "lateReceipts": 0,
                "unitsOrdered": 0.0,
                "unitsReceived": 0.0,
                "openUnits": 0.0,
                "commitmentValue": 0.0,
                "openCommitmentValue": 0.0,
                "fillRate": None,
                "onTimeRate": None,
                "averageLeadTimeDays": None,
                "leadTimeP90Days": None,
                "leadTimeVariabilityDays": 0.0,
                "delayRiskScore": 0.0,
                "serviceScore": 100.0,
            },
        )
        exposed_skus = [
            item
            for item in sku_forecasts
            if normalize_supplier_name(item.get("supplier")) == supplier
            and item.get("riskLevel") in ("critical", "high", "medium")
        ]
        max_stockout_probability = max([to_number(item.get("stockoutProbability")) for item in exposed_skus], default=0.0)
        exposed_revenue = sum(to_number(item.get("forecastRevenue")) for item in exposed_skus)
        weighted_risk_score = clamp(
            to_number(baseline.get("delayRiskScore"))
            + len(exposed_skus) * 8.0
            + max_stockout_probability * 28.0
            + clamp(to_number(baseline.get("openUnits")) / max(1.0, to_number(baseline.get("unitsOrdered"))), 0.0, 1.0)
            * 14.0,
            0.0,
            100.0,
        )
        tone = get_supplier_signal_tone(weighted_risk_score)

        supplier_signals.append(
            {
                "supplier": supplier,
                "weightedRiskScore": round_value(weighted_risk_score, 1),
                "statusTone": tone,
                "serviceScore": round_value(baseline.get("serviceScore"), 0),
                "delayRiskScore": round_value(baseline.get("delayRiskScore"), 1),
                "orderCount": int(to_number(baseline.get("orderCount"))),
                "receivedOrders": int(to_number(baseline.get("receivedOrders"))),
                "openOrders": int(to_number(baseline.get("openOrders"))),
                "lateOpenOrders": int(to_number(baseline.get("lateOpenOrders"))),
                "lateReceipts": int(to_number(baseline.get("lateReceipts"))),
                "fillRate": None if baseline.get("fillRate") is None else round_value(baseline.get("fillRate"), 1),
                "onTimeRate": None if baseline.get("onTimeRate") is None else round_value(baseline.get("onTimeRate"), 1),
                "averageLeadTimeDays": None
                if baseline.get("averageLeadTimeDays") is None
                else round_value(baseline.get("averageLeadTimeDays"), 1),
                "leadTimeP90Days": None
                if baseline.get("leadTimeP90Days") is None
                else round_value(baseline.get("leadTimeP90Days"), 1),
                "leadTimeVariabilityDays": round_value(baseline.get("leadTimeVariabilityDays"), 2),
                "openCommitmentValue": round_value(baseline.get("openCommitmentValue")),
                "openUnits": round_value(baseline.get("openUnits"), 1),
                "exposedSkuCount": len(exposed_skus),
                "maxStockoutProbability": round_value(max_stockout_probability, 4),
                "exposedForecastRevenue": round_value(exposed_revenue),
                "nextAction": build_supplier_action({"supplier": supplier, "weightedRiskScore": weighted_risk_score}),
                "topDrivers": _build_supplier_top_drivers(baseline, exposed_skus, weighted_risk_score),
            }
        )

    supplier_signals.sort(
        key=lambda item: (
            -to_number(item.get("weightedRiskScore")),
            -to_number(item.get("openCommitmentValue")),
            -to_number(item.get("maxStockoutProbability")),
            item.get("supplier") or "",
        )
    )
    return supplier_signals[:limit]
