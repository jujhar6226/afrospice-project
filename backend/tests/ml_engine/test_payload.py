from ml_engine.payload import (
    build_portfolio_summary,
    build_promotion_candidates,
    build_stockout_risks,
)


def test_build_stockout_risks_carries_policy_and_capital_fields():
    risks = build_stockout_risks(
        [
            {
                "id": "prod-1",
                "name": "Palm Oil",
                "sku": "SKU-001",
                "supplier": "Prime Farm",
                "riskLevel": "high",
                "stockPolicyClass": "protect",
                "serviceLevelTargetPct": 97,
                "cashPriorityScore": 83.2,
                "cashPriorityTier": "protect-now",
                "cashPriorityReason": "Protect this line first.",
                "currentStock": 2,
                "inboundUnits": 0,
                "forecastRevenue": 320,
                "daysCover": 1.5,
                "recommendedOrderQty": 12,
                "orderSpend": 144,
                "confidenceScore": 71,
                "stockoutProbability": 0.82,
                "reason": "Palm Oil is likely to fall short.",
                "topDrivers": ["Projected stockout probability is above the safe operating band."],
                "nextAction": "Protect this SKU first and confirm inbound coverage today.",
            }
        ]
    )

    assert risks[0]["stockPolicyClass"] == "protect"
    assert risks[0]["cashPriorityTier"] == "protect-now"
    assert risks[0]["orderSpend"] == 144


def test_build_promotion_candidates_skips_protect_policy_lines():
    candidates = build_promotion_candidates(
        [
            {
                "id": "prod-1",
                "name": "Palm Oil",
                "sku": "SKU-001",
                "category": "Staples",
                "supplier": "Prime Farm",
                "stockPolicyClass": "protect",
                "trendDirection": "rising",
                "currentStock": 24,
                "reorderPoint": 8,
                "stockBuffer": 16,
                "forecastRevenue": 420,
                "confidenceScore": 76,
                "grossMarginPct": 32,
                "stockoutProbability": 0.08,
                "nextAction": "Promote carefully while stock buffer remains healthy.",
            }
        ]
    )

    assert candidates == []


def test_build_portfolio_summary_includes_capital_priority_fields():
    summary = build_portfolio_summary(
        [
            {
                "recommendedOrderQty": 8,
                "unitCost": 10,
                "orderSpend": 80,
                "cashPriorityTier": "protect-now",
                "stockPolicyClass": "protect",
                "forecastRevenue": 240,
            },
            {
                "recommendedOrderQty": 3,
                "unitCost": 12,
                "orderSpend": 36,
                "cashPriorityTier": "defer",
                "stockPolicyClass": "standard",
                "forecastRevenue": 96,
            },
        ],
        [{"forecastRevenue": 240}],
        [{"forecastRevenue": 150, "grossMarginPct": 30}],
        [{"statusTone": "warning"}],
    )

    assert summary["highPriorityOrderSpend"] == 80
    assert summary["protectedRevenue"] == 240
    assert summary["deferredSkuCount"] == 1
