from datetime import datetime, timedelta, timezone

from ml_engine.supplier import build_supplier_execution_baseline


def test_build_supplier_execution_baseline_uses_expected_date():
    anchor = datetime(2026, 3, 27, tzinfo=timezone.utc)
    baseline = build_supplier_execution_baseline(
        [
            {
                "supplier": "Fresh Foods",
                "status": "Sent",
                "createdAt": anchor - timedelta(days=5),
                "expectedDate": anchor - timedelta(days=1),
                "items": [
                    {
                        "qtyOrdered": 10,
                        "qtyReceived": 0,
                        "unitCost": 2.5,
                    }
                ],
            }
        ],
        anchor,
    )
    assert baseline["Fresh Foods"]["lateOpenOrders"] == 1


def test_build_supplier_execution_baseline_tracks_fill_rate():
    anchor = datetime(2026, 3, 27, tzinfo=timezone.utc)
    baseline = build_supplier_execution_baseline(
        [
            {
                "supplier": "Prime Farm",
                "status": "Received",
                "createdAt": anchor - timedelta(days=4),
                "sentAt": anchor - timedelta(days=3),
                "receivedAt": anchor - timedelta(days=1),
                "items": [
                    {
                        "qtyOrdered": 10,
                        "qtyReceived": 8,
                        "unitCost": 5.0,
                    }
                ],
            }
        ],
        anchor,
    )
    assert baseline["Prime Farm"]["fillRate"] == 80.0
