"""Named constants for the AfroSpice operational ML engine."""

DEFAULT_HISTORY_DAYS = 84
DEFAULT_LEAD_TIME_DAYS = 7.0
DEFAULT_SERVICE_LEVEL_Z = 1.28
DEFAULT_LOW_STOCK_THRESHOLD = 10.0

SERVICE_LEVELS_BY_POLICY = {
    "protect": {"targetPct": 97.0, "z": 1.88},
    "staple": {"targetPct": 95.0, "z": 1.65},
    "standard": {"targetPct": 90.0, "z": 1.28},
    "cautious": {"targetPct": 84.0, "z": 0.99},
}

SEASONALITY_CLAMP_DAILY = (0.72, 1.28)
SEASONALITY_CLAMP_MONTHLY = (0.80, 1.20)

RANGE_HISTORY_POINTS = {
    "daily": 28,
    "weekly": 16,
    "monthly": 12,
    "yearly": 4,
}

RANGE_HORIZON_DEFAULTS = {
    "daily": 14,
    "weekly": 8,
    "monthly": 4,
    "yearly": 2,
}

RANGE_HORIZON_MAX = {
    "daily": 30,
    "weekly": 12,
    "monthly": 6,
    "yearly": 4,
}

DEFAULT_MODEL_LIMIT = 8
MIN_MODEL_LIMIT = 1
MAX_MODEL_LIMIT = 12

MIN_PLANNING_DAYS = 7
MAX_PLANNING_DAYS = 42

PREDICTION_INTERVAL_LABEL = "80%"
PREDICTION_INTERVAL_Z = 1.28
FORECAST_RESIDUAL_FLOOR_REVENUE = 1.0
FORECAST_RESIDUAL_FLOOR_ORDERS = 0.6

ANOMALY_WINDOW_DAYS = 42
ANOMALY_BASELINE_DAYS = 14
ANOMALY_WARNING_Z = 2.4
ANOMALY_DANGER_Z = 3.2
MAX_ANOMALY_ALERTS = 6

TREND_RISE_PCT = 12.0
TREND_FALL_PCT = -12.0

SPARSE_HISTORY_OBSERVED_DAYS = 6
SPARSE_HISTORY_UNITS = 12.0
INTERMITTENT_ZERO_RATIO = 0.72
CATEGORY_FALLBACK_BASE_BLEND = 0.28
CATEGORY_FALLBACK_MAX_BLEND = 0.62
INTERMITTENT_BLEND = 0.35

STOCKOUT_INTEGRITY_ADJUSTMENT = 0.18
STOCKOUT_SUPPLIER_ADJUSTMENT = 0.14
CONFIDENCE_INTEGRITY_PENALTY = 10.0
CONFIDENCE_SUPPLIER_PENALTY = 9.0

STOCKOUT_CRITICAL_PROBABILITY = 0.65
STOCKOUT_HIGH_PROBABILITY = 0.60
STOCKOUT_MEDIUM_PROBABILITY = 0.35

PROMOTION_MIN_CONFIDENCE = 48.0
PROMOTION_MIN_MARGIN_PCT = 18.0
PROMOTION_MAX_STOCKOUT_PROBABILITY = 0.22

SUPPLIER_DANGER_RISK = 72.0
SUPPLIER_WARNING_RISK = 42.0

PAID_SALE_STATUSES = {"paid"}
REFUNDED_SALE_STATUSES = {"refunded"}
DECLINED_SALE_STATUSES = {"declined"}
RECEIVED_PO_STATUSES = {"received"}
CLOSED_PO_STATUSES = {"received", "cancelled"}

MODEL_ENGINE = "python-operational-ml-v3"
MODEL_FAMILY = "probabilistic-demand-intelligence"
ENGINE_VERSION = "3.0.0"
SCORING_VERSION = "3.0.0"
MODEL_METHOD = (
    "Damped Holt trend with empirical seasonality, intermittent-demand blending, "
    "category fallback support, rolling holdout scoring, robust anomaly detection, "
    "supplier execution scoring, policy-aware service levels, cash-priority ranking, "
    "and lead-time-aware stockout planning on live Mongo-backed data."
)
