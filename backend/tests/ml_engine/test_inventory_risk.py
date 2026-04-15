from ml_engine.inventory_risk import (
    _build_cash_priority_score,
    _build_stock_policy_class,
    _get_cash_priority_tier,
    build_risk_level,
    build_risk_reason,
    compute_stockout_probability,
)


def test_compute_stockout_probability_zero_mean():
    assert compute_stockout_probability(0, 1, 10) == 0.0


def test_build_risk_level_critical():
    result = build_risk_level(0.8, 1, 7, 20, 0, 0)
    assert result == "critical"


def test_build_risk_reason_contains_name():
    result = build_risk_reason("Palm Oil", "high", 2, 0.7, 5, 0, "rising")
    assert "Palm Oil" in result


def test_build_stock_policy_class_protect_for_fast_confident_sku():
    result = _build_stock_policy_class("fast", "rising", 28.0, 71.0, "stable")
    assert result == "protect"


def test_get_cash_priority_tier_protect_now():
    score = _build_cash_priority_score(
        "critical",
        0.91,
        34.0,
        840.0,
        0.45,
        72.0,
        "protect",
        "stable",
        190.0,
    )
    assert _get_cash_priority_tier(score) == "protect-now"
