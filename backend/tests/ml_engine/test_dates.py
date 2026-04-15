from ml_engine.dates import parse_date


def test_parse_date_supports_iso_z():
    parsed = parse_date("2026-03-27T10:00:00Z")
    assert parsed is not None
    assert parsed.year == 2026
    assert parsed.month == 3
    assert parsed.day == 27


def test_parse_date_invalid_returns_none():
    assert parse_date("not-a-date") is None
