const AppError = require("../errors/AppError");
const cycleCountRepository = require("../data/repositories/cycleCountRepository");
const auditLogService = require("./auditLogService");
const { compactText } = require("../validation/helpers");

function normalizeDraftItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      productId: Number(item.productId || item.id),
    }))
    .filter((item) => item.productId);
}

function normalizeCompletionItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      productId: Number(item.productId || item.id),
      countedQty: Number(item.countedQty),
    }))
    .filter((item) => item.productId);
}

async function listCycleCounts(limit = 5) {
  const normalizedLimit = Number(limit);
  return cycleCountRepository.getCycleCounts(
    Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 5
  );
}

async function getCycleCountById(id) {
  const count = await cycleCountRepository.getCycleCountById(id);

  if (!count) {
    throw new AppError(404, "Cycle count not found.", {
      code: "CYCLE_COUNT_NOT_FOUND",
    });
  }

  return count;
}

async function createQuickCycleCount(payload, actor) {
  const selectedItems = normalizeDraftItems(payload?.items);

  if (!selectedItems.length) {
    throw new AppError(400, "Select at least one product before starting a cycle count.", {
      code: "CYCLE_COUNT_ITEMS_REQUIRED",
    });
  }

  const items = [];
  for (const item of selectedItems) {
    const product = await cycleCountRepository.getProductById(item.productId);

    if (!product) {
      throw new AppError(400, `Product not found for line ${item.productId}.`, {
        code: "CYCLE_COUNT_PRODUCT_NOT_FOUND",
      });
    }

    items.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      expectedQty: Number(product.stock || 0),
      countedQty: null,
      varianceQty: null,
      status: "Pending",
    });
  }

  const count = await cycleCountRepository.createCycleCount({
    note: compactText(payload?.note || "Quick count created from the inventory workspace."),
    createdBy: String(actor?.fullName || actor?.staffId || "System").trim(),
    items,
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "inventory.cycle_count_created",
    entityType: "cycle_count",
    entityId: String(count.id),
    details: {
      linesCount: count.linesCount,
      note: count.note,
    },
  });

  return count;
}

async function completeCycleCount(id, payload, actor) {
  const items = normalizeCompletionItems(payload?.items);

  if (!items.length) {
    throw new AppError(400, "Counted quantities are required to complete the cycle count.", {
      code: "CYCLE_COUNT_ITEMS_REQUIRED",
    });
  }

  try {
    const count = await cycleCountRepository.completeCycleCount(id, {
      items,
      note: compactText(payload?.note || "Cycle count completed from inventory workspace."),
      actorName: String(actor?.fullName || actor?.staffId || "System").trim(),
      completedAt: payload?.completedAt,
    });

    if (!count) {
      throw new AppError(404, "Cycle count not found.", {
        code: "CYCLE_COUNT_NOT_FOUND",
      });
    }

    await auditLogService.recordAuditEvent({
      actor,
      action: "inventory.cycle_count_completed",
      entityType: "cycle_count",
      entityId: String(count.id),
      details: {
        varianceLines: count.varianceLines,
        varianceUnits: count.varianceUnits,
        status: count.status,
      },
    });

    return count;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (
      String(error.message || "").includes("not found") ||
      String(error.message || "").includes("Only open cycle counts") ||
      String(error.message || "").includes("valid counted quantity")
    ) {
      throw new AppError(400, error.message, {
        code: "CYCLE_COUNT_INVALID",
      });
    }

    throw error;
  }
}

module.exports = {
  listCycleCounts,
  getCycleCountById,
  createQuickCycleCount,
  completeCycleCount,
};
