"""Date parsing and range helpers."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone


def parse_date(value) -> datetime | None:
    """Parse supported incoming date values into UTC-aware datetimes."""
    if not value:
        return None

    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    text = str(value).strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        parsed = None
        for pattern in ("%Y-%m-%d", "%Y/%m/%d"):
            try:
                parsed = datetime.strptime(text, pattern)
                break
            except ValueError:
                continue
        if parsed is None:
            return None

    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def iso(value: datetime | None) -> str | None:
    """Serialize a datetime to UTC ISO-8601 with Z suffix."""
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def start_of_day(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def start_of_week(value: datetime) -> datetime:
    day = start_of_day(value)
    return day - timedelta(days=day.weekday())


def start_of_month(value: datetime) -> datetime:
    return start_of_day(value).replace(day=1)


def start_of_year(value: datetime) -> datetime:
    return start_of_day(value).replace(month=1, day=1)


def add_days(value: datetime, amount: int) -> datetime:
    return value + timedelta(days=amount)


def add_months(value: datetime, amount: int) -> datetime:
    year = value.year + (value.month - 1 + amount) // 12
    month = ((value.month - 1 + amount) % 12) + 1
    return value.replace(year=year, month=month, day=1)


def add_years(value: datetime, amount: int) -> datetime:
    return value.replace(year=value.year + amount, month=1, day=1)


def start_of_range(value: datetime, range_key: str) -> datetime:
    if range_key == "daily":
        return start_of_day(value)
    if range_key == "weekly":
        return start_of_week(value)
    if range_key == "yearly":
        return start_of_year(value)
    return start_of_month(value)


def add_range_step(value: datetime, range_key: str, amount: int) -> datetime:
    if range_key == "daily":
        return add_days(value, amount)
    if range_key == "weekly":
        return add_days(value, amount * 7)
    if range_key == "yearly":
        return add_years(value, amount)
    return add_months(value, amount)


def get_range_step_days(range_key: str) -> int:
    if range_key == "daily":
        return 1
    if range_key == "weekly":
        return 7
    if range_key == "yearly":
        return 365
    return 30


def format_bucket_label(value: datetime, range_key: str) -> str:
    value = value.astimezone(timezone.utc)
    if range_key == "daily":
        return value.strftime("%b %-d") if sys.platform != "win32" else value.strftime("%b %#d")
    if range_key == "weekly":
        day = value.strftime("%b %-d") if sys.platform != "win32" else value.strftime("%b %#d")
        return f"Week of {day}"
    if range_key == "yearly":
        return str(value.year)
    return value.strftime("%Y %b")


def get_weekday_index(value: datetime) -> int:
    return value.weekday()
