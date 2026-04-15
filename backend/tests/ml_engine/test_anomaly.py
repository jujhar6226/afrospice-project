from datetime import datetime, timedelta, timezone

from ml_engine.anomaly import build_anomaly_outputs


def test_build_anomaly_outputs_returns_summary_and_alerts():
    anchor = datetime(2026, 3, 27, tzinfo=timezone.utc)
    sales = []
    for day in range(20):
        sale_date = anchor - timedelta(days=20 - day)
        sales.append(
            {
                "date": sale_date,
                "status": "Paid",
                "total": 10 if day < 18 else 120,
                "items": [],
            }
        )

    result = build_anomaly_outputs(sales, anchor)
    assert "summary" in result
    assert "alerts" in result
    assert isinstance(result["alerts"], list)
