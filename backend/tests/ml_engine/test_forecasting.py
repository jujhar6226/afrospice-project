from ml_engine.forecasting import backtest_series, build_confidence_breakdown


def test_backtest_series_returns_wape_for_valid_series():
    result = backtest_series([1, 2, 3, 4, 5, 6, 7, 8], 3)
    assert result["holdoutPoints"] == 3
    assert result["wape"] is not None


def test_confidence_breakdown_returns_total_score():
    result = build_confidence_breakdown(
        history_points=28,
        observed_points=12,
        holdout_wape=24.0,
        horizon=7,
        lead_samples=3,
        data_quality_penalty=4.0,
    )
    assert result["total"] >= 18
    assert result["coverageScore"] > 0
