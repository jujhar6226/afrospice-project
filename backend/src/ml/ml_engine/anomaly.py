"""Operational anomaly detection outputs."""

from __future__ import annotations

from datetime import timedelta
from statistics import median

from .constants import ANOMALY_BASELINE_DAYS, ANOMALY_DANGER_Z, ANOMALY_WARNING_Z, ANOMALY_WINDOW_DAYS, DECLINED_SALE_STATUSES, MAX_ANOMALY_ALERTS, PAID_SALE_STATUSES, REFUNDED_SALE_STATUSES
from .dates import iso, start_of_day
from .utils import round_value, to_number


def build_anomaly_outputs(sales, anchor_date):
    """Detect unusual movement in key business metrics and summarize the alerts."""
    start_date = start_of_day(anchor_date) - timedelta(days=ANOMALY_WINDOW_DAYS - 1)
    daily = {}
    for offset in range(ANOMALY_WINDOW_DAYS):
        current = start_date + timedelta(days=offset)
        daily[iso(current)] = {
            "date": iso(current)[:10],
            "revenue": 0.0,
            "orders": 0.0,
            "refundRate": 0.0,
            "declineRate": 0.0,
            "paidRate": 100.0,
            "paidOrders": 0.0,
            "refundOrders": 0.0,
            "declinedOrders": 0.0,
            "totalOrders": 0.0,
        }

    for sale in sales:
        key = iso(start_of_day(sale["date"]))
        if key not in daily:
            continue
        bucket = daily[key]
        bucket["totalOrders"] += 1.0
        status = str(sale.get("status") or "").strip().lower()
        if status in PAID_SALE_STATUSES:
            bucket["paidOrders"] += 1.0
            bucket["revenue"] += to_number(sale.get("total"))
            bucket["orders"] += 1.0
        elif status in REFUNDED_SALE_STATUSES:
            bucket["refundOrders"] += 1.0
        elif status in DECLINED_SALE_STATUSES:
            bucket["declinedOrders"] += 1.0

    ordered = [daily[key] for key in sorted(daily.keys())]
    for bucket in ordered:
        total = max(1.0, bucket["totalOrders"])
        bucket["refundRate"] = (bucket["refundOrders"] / total) * 100.0
        bucket["declineRate"] = (bucket["declinedOrders"] / total) * 100.0
        bucket["paidRate"] = (bucket["paidOrders"] / total) * 100.0

    metric_specs = [
        ("revenue", "Revenue"),
        ("orders", "Orders"),
        ("refundRate", "Refund rate"),
        ("declineRate", "Decline rate"),
        ("paidRate", "Paid conversion"),
    ]

    alerts = []
    anomaly_series = []

    for metric, label in metric_specs:
        for index in range(ANOMALY_BASELINE_DAYS, len(ordered)):
            history_values = [ordered[lookback][metric] for lookback in range(index - ANOMALY_BASELINE_DAYS, index)]
            non_zero_history = sum(1 for value in history_values if abs(value) > 0.01)
            center = median(history_values)
            mad = median([abs(value - center) for value in history_values])
            scale = max(0.1, mad * 1.4826)
            actual = ordered[index][metric]
            z_score = 0.6745 * (actual - center) / max(scale, 0.1)
            deviation_pct = (
                ((actual - center) / abs(center) * 100.0)
                if abs(center) > 0.01
                else (100.0 if abs(actual) > 0.01 else 0.0)
            )
            anomaly_series.append(
                {
                    "date": ordered[index]["date"],
                    "metric": metric,
                    "value": round_value(actual),
                    "baseline": round_value(center),
                    "deviationPercent": round_value(deviation_pct, 1),
                    "zScore": round_value(z_score, 2),
                }
            )
            if abs(z_score) < ANOMALY_WARNING_Z:
                continue
            if non_zero_history < 3:
                continue
            if metric == "paidRate" and actual >= center:
                continue
            if metric in ("refundRate", "declineRate") and actual <= center:
                continue
            tone = "danger" if abs(z_score) >= ANOMALY_DANGER_Z else "warning"
            direction = "higher" if actual >= center else "lower"
            alerts.append(
                {
                    "metric": metric,
                    "headline": f"{label} anomaly on {ordered[index]['date']}",
                    "summary": f"{label} came in {direction} than its rolling baseline by {round_value(abs(deviation_pct), 1)}%.",
                    "tone": tone,
                    "date": ordered[index]["date"],
                    "value": round_value(actual),
                    "baseline": round_value(center),
                    "deviationPercent": round_value(deviation_pct, 1),
                    "zScore": round_value(z_score, 2),
                }
            )

    alerts.sort(key=lambda item: (-abs(to_number(item["zScore"])), -abs(to_number(item["deviationPercent"]))))
    alerts = alerts[:MAX_ANOMALY_ALERTS]

    status_tone = "success"
    if any(item["tone"] == "danger" for item in alerts):
        status_tone = "danger"
    elif any(item["tone"] == "warning" for item in alerts):
        status_tone = "warning"

    return {
        "summary": {
            "totalAlerts": len(alerts),
            "statusTone": status_tone,
            "headline": "Operational anomalies detected" if alerts else "No material anomaly detected",
        },
        "alerts": alerts,
        "recentDailySeries": anomaly_series[-25:],
    }
