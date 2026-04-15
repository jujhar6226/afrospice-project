"""Normalization helpers for turning raw payload data into typed internal records."""

from __future__ import annotations

import logging

from .dates import parse_date
from .utils import to_number

logger = logging.getLogger(__name__)


def normalize_status(value) -> str:
    """Normalize arbitrary status strings into a consistent title-cased label."""
    text = str(value or "").strip().lower()
    if not text:
        return ""
    return " ".join(part.capitalize() for part in text.replace("_", " ").split())


def build_sales(records):
    sales = []
    for sale in records or []:
        sale_date = parse_date(sale.get("date") or sale.get("createdAt"))
        if not sale_date:
            logger.warning("Skipped sale with invalid date: %s", sale.get("id"))
            continue

        normalized_items = []
        for item in sale.get("items") or []:
            normalized_items.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "sku": item.get("sku"),
                    "qty": max(0.0, to_number(item.get("qty"))),
                    "price": max(0.0, to_number(item.get("price"))),
                    "unitCost": max(0.0, to_number(item.get("unitCost"))),
                    "lineTotal": max(0.0, to_number(item.get("lineTotal"))),
                    "category": item.get("category"),
                    "supplier": item.get("supplier"),
                }
            )

        sales.append(
            {
                "id": sale.get("id"),
                "status": normalize_status(sale.get("status")),
                "total": max(0.0, to_number(sale.get("total"))),
                "paymentMethod": sale.get("paymentMethod"),
                "channel": sale.get("channel"),
                "cashier": sale.get("cashier"),
                "customer": sale.get("customer"),
                "date": sale_date,
                "items": normalized_items,
            }
        )
    return sales


def build_products(records):
    return [
        {
            "id": product.get("id"),
            "name": product.get("name"),
            "sku": product.get("sku"),
            "category": product.get("category") or "General",
            "supplier": product.get("supplier") or "General Supplier",
            "stock": max(0.0, to_number(product.get("stock"))),
            "price": max(0.0, to_number(product.get("price"))),
            "unitCost": max(0.0, to_number(product.get("unitCost"))),
            "status": product.get("status"),
            "launchDate": parse_date(product.get("launchDate")),
        }
        for product in (records or [])
    ]


def build_purchase_orders(records):
    purchase_orders = []
    for order in records or []:
        purchase_orders.append(
            {
                "id": order.get("id"),
                "supplier": order.get("supplier") or "General Supplier",
                "status": normalize_status(order.get("status")),
                "createdAt": parse_date(order.get("createdAt")),
                "updatedAt": parse_date(order.get("updatedAt")),
                "expectedDate": parse_date(order.get("expectedDate")),
                "sentAt": parse_date(order.get("sentAt")),
                "receivedAt": parse_date(order.get("receivedAt")),
                "items": [
                    {
                        "productId": item.get("productId"),
                        "productName": item.get("productName"),
                        "sku": item.get("sku"),
                        "qtyOrdered": max(0.0, to_number(item.get("qtyOrdered"))),
                        "qtyReceived": max(0.0, to_number(item.get("qtyReceived"))),
                        "unitCost": max(0.0, to_number(item.get("unitCost"))),
                    }
                    for item in (order.get("items") or [])
                ],
            }
        )
    return purchase_orders


def build_inventory_movements(records):
    movements = []
    for movement in records or []:
        created_at = parse_date(movement.get("createdAt"))
        if movement.get("createdAt") and not created_at:
            logger.warning("Skipped inventory movement with invalid date: %s", movement.get("id"))
            continue

        movements.append(
            {
                "id": movement.get("id"),
                "productId": movement.get("productId"),
                "productName": movement.get("productName"),
                "sku": movement.get("sku"),
                "movementType": str(movement.get("movementType") or "").strip(),
                "quantityDelta": to_number(movement.get("quantityDelta")),
                "quantityAfter": to_number(movement.get("quantityAfter")),
                "referenceType": movement.get("referenceType"),
                "referenceId": movement.get("referenceId"),
                "createdAt": created_at,
            }
        )
    return movements


def build_cycle_counts(records):
    counts = []
    for count in records or []:
        counts.append(
            {
                "id": count.get("id"),
                "status": normalize_status(count.get("status")),
                "scope": count.get("scope"),
                "createdAt": parse_date(count.get("createdAt")),
                "updatedAt": parse_date(count.get("updatedAt")),
                "items": [
                    {
                        "productId": item.get("productId"),
                        "productName": item.get("productName"),
                        "sku": item.get("sku"),
                        "expectedQty": to_number(item.get("expectedQty")),
                        "countedQty": to_number(item.get("countedQty")),
                        "varianceQty": to_number(item.get("varianceQty")),
                    }
                    for item in (count.get("items") or [])
                ],
            }
        )
    return counts


def build_entities(records, kind):
    return [
        {
            "id": entry.get("id"),
            "name": entry.get("name"),
            "email": entry.get("email"),
            "phone": entry.get("phone"),
            "role": entry.get("role") if kind == "user" else None,
            "status": entry.get("status") if kind == "user" else None,
            "createdAt": parse_date(entry.get("createdAt")),
            "updatedAt": parse_date(entry.get("updatedAt")),
        }
        for entry in (records or [])
    ]
