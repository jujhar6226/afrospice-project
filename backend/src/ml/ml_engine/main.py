"""CLI entrypoint for the operational ML engine."""

from __future__ import annotations

import json
import logging
import os
import sys

from .payload import build_payload


def configure_logging() -> None:
    level_name = str(os.getenv("ML_LOG_LEVEL", "WARNING")).strip().upper() or "WARNING"
    level = getattr(logging, level_name, logging.WARNING)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
        stream=sys.stderr,
    )


def main() -> None:
    configure_logging()
    try:
        raw_input = sys.stdin.read()
        payload = json.loads(raw_input or "{}")
        result = build_payload(payload)
        sys.stdout.write(json.dumps({"success": True, "data": result}))
    except Exception as exc:  # pragma: no cover - exercised by CLI failure handling
        logging.getLogger(__name__).exception("Operational ML engine failed")
        sys.stdout.write(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)
