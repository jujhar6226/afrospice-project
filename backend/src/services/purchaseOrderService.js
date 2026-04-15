const AppError = require("../errors/AppError");
const purchaseOrderRepository = require("../data/repositories/purchaseOrderRepository");
const auditLogService = require("./auditLogService");
const { compactText } = require("../validation/helpers");

function buildActorName(user) {
  return String(user?.fullName || user?.staffId || "System").trim();
}

function normalizeDraftItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      productId: Number(item.productId || item.id),
      supplier: compactText(item.supplier || ""),
      qtyOrdered: Number(item.qtyOrdered || item.recommendedQty || 0),
      unitCost: Number(item.unitCost || item.price || 0),
    }))
    .filter((item) => item.productId && item.qtyOrdered > 0);
}

function normalizeStatus(status) {
  const value = compactText(status || "Draft");
  return ["Draft", "Sent", "Cancelled"].includes(value) ? value : "";
}

async function listPurchaseOrders(limit = 6) {
  const normalizedLimit = Number(limit);
  return purchaseOrderRepository.getPurchaseOrders(
    Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 6
  );
}

async function getPurchaseOrderById(id) {
  const order = await purchaseOrderRepository.getPurchaseOrderById(id);

  if (!order) {
    throw new AppError(404, "Purchase order not found.", {
      code: "PURCHASE_ORDER_NOT_FOUND",
    });
  }

  return order;
}

async function createPurchaseOrder(payload, actor) {
  const supplier = compactText(payload?.supplier || "");
  const items = normalizeDraftItems(payload?.items);

  if (!supplier) {
    throw new AppError(400, "Supplier is required.", {
      code: "SUPPLIER_REQUIRED",
    });
  }

  if (!items.length) {
    throw new AppError(400, "At least one purchase order line is required.", {
      code: "PURCHASE_ORDER_ITEMS_REQUIRED",
    });
  }

  const normalizedItems = [];
  for (const item of items) {
    const product = await purchaseOrderRepository.getProductById(item.productId);

    if (!product) {
      throw new AppError(400, `Product not found for line ${item.productId}.`, {
        code: "PURCHASE_ORDER_PRODUCT_NOT_FOUND",
      });
    }

    normalizedItems.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      qtyOrdered: item.qtyOrdered,
      qtyReceived: 0,
      unitCost: item.unitCost > 0 ? item.unitCost : Number(product.unitCost || product.price || 0),
    });
  }

  const order = await purchaseOrderRepository.createPurchaseOrder({
    supplier,
    status: "Draft",
    note: compactText(payload?.note || ""),
    createdBy: buildActorName(actor),
    expectedDate: payload?.expectedDate ? String(payload.expectedDate) : null,
    items: normalizedItems,
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "purchase_order.created",
    entityType: "purchase_order",
    entityId: String(order.id),
    details: {
      supplier: order.supplier,
      linesCount: order.linesCount,
      totalEstimatedCost: order.totalEstimatedCost,
    },
  });

  return order;
}

async function createBulkDraftPurchaseOrders(payload, actor) {
  const items = normalizeDraftItems(payload?.items);

  if (!items.length) {
    throw new AppError(400, "Select at least one reorder line before creating purchase orders.", {
      code: "PURCHASE_ORDER_ITEMS_REQUIRED",
    });
  }

  const grouped = {};
  for (const item of items) {
    const product = await purchaseOrderRepository.getProductById(item.productId);

    if (!product) {
      throw new AppError(400, `Product not found for line ${item.productId}.`, {
        code: "PURCHASE_ORDER_PRODUCT_NOT_FOUND",
      });
    }

    const supplier =
      item.supplier || String(product.supplier || "General Supplier").trim() || "General Supplier";

    if (!grouped[supplier]) {
      grouped[supplier] = [];
    }

    grouped[supplier].push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      qtyOrdered: item.qtyOrdered,
      qtyReceived: 0,
      unitCost: item.unitCost > 0 ? item.unitCost : Number(product.unitCost || product.price || 0),
    });
  }

  const orders = [];
  for (const [supplier, orderItems] of Object.entries(grouped)) {
    // eslint-disable-next-line no-await-in-loop
    const order = await purchaseOrderRepository.createPurchaseOrder({
      supplier,
      status: "Draft",
      note: "Drafted from the reorder planner.",
      createdBy: buildActorName(actor),
      items: orderItems,
    });
    orders.push(order);
  }

  await auditLogService.recordAuditEvent({
    actor,
    action: "purchase_order.bulk_drafted",
    entityType: "purchase_order",
    entityId: "bulk",
    details: {
      createdCount: orders.length,
      orderIds: orders.map((order) => order.id),
    },
  });

  return {
    orders,
    createdCount: orders.length,
  };
}

async function updatePurchaseOrderStatus(id, payload, actor) {
  const status = normalizeStatus(payload?.status);

  if (!status) {
    throw new AppError(400, "A valid purchase order status is required.", {
      code: "INVALID_PURCHASE_ORDER_STATUS",
    });
  }

  const existing = await getPurchaseOrderById(id);
  const order = await purchaseOrderRepository.updatePurchaseOrderStatus(id, status);

  await auditLogService.recordAuditEvent({
    actor,
    action: "purchase_order.status_updated",
    entityType: "purchase_order",
    entityId: String(order.id),
    details: {
      previousStatus: existing.status,
      nextStatus: order.status,
    },
  });

  return order;
}

async function receivePurchaseOrder(id, payload, actor) {
  try {
    const order = await purchaseOrderRepository.receivePurchaseOrder(id, {
      items: payload?.items,
      note: payload?.note,
      actorName: buildActorName(actor),
      receivedAt: payload?.receivedAt,
    });

    if (!order) {
      throw new AppError(404, "Purchase order not found.", {
        code: "PURCHASE_ORDER_NOT_FOUND",
      });
    }

    await auditLogService.recordAuditEvent({
      actor,
      action: "inventory.purchase_order_received",
      entityType: "purchase_order",
      entityId: String(order.id),
      details: {
        supplier: order.supplier,
        status: order.status,
        unitsReceived: order.unitsReceived,
        openUnits: order.openUnits,
      },
    });

    return order;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (
      String(error.message || "").includes("not found") ||
      String(error.message || "").includes("cannot be received") ||
      String(error.message || "").includes("Invalid receive quantity")
    ) {
      throw new AppError(400, error.message, {
        code: "PURCHASE_ORDER_RECEIVE_INVALID",
      });
    }

    throw error;
  }
}

module.exports = {
  listPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  createBulkDraftPurchaseOrders,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
};
