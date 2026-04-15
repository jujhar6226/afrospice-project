const AppError = require("../errors/AppError");
const salesRepository = require("../data/repositories/salesRepository");
const auditLogService = require("./auditLogService");
const customerService = require("./customerService");
const { calculateTaxAmount } = require("../tax/ontarioProductTax");
const {
  validateCreateSalePayload,
  validateSaleStatusPayload,
} = require("../validation/salesValidators");

function normalizeStatus(status) {
  const value = String(status || "Paid").trim().toLowerCase();
  if (["paid", "completed", "success"].includes(value)) return "Paid";
  if (["pending", "processing", "awaiting"].includes(value)) return "Pending";
  if (["declined", "failed", "cancelled", "canceled"].includes(value)) return "Declined";
  if (["refunded", "refund"].includes(value)) return "Refunded";
  return "Paid";
}

function computeSaleTotals(items, customerDiscountPercent = 0) {
  const normalizedDiscountPercent = Math.max(0, Number(customerDiscountPercent || 0));

  const normalizedItems = items.map((item) => {
    const lineBaseSubtotal = Number((Number(item.qty || 0) * Number(item.price || 0)).toFixed(2));
    const discountPercent = Math.max(0, Number(item.discountPercent ?? normalizedDiscountPercent));
    const discountAmount = Number(((lineBaseSubtotal * discountPercent) / 100).toFixed(2));
    const lineSubtotal = Number((lineBaseSubtotal - discountAmount).toFixed(2));
    const taxRate = Number(item.taxRate || 0);
    const taxAmount = calculateTaxAmount(lineSubtotal, taxRate);
    const lineGrossTotal = Number((lineSubtotal + taxAmount).toFixed(2));

    return {
      ...item,
      discountPercent,
      discountAmount,
      lineBaseSubtotal,
      taxRate,
      lineSubtotal,
      taxAmount,
      lineTotal: lineSubtotal,
      lineGrossTotal,
    };
  });

  const preDiscountSubtotal = normalizedItems.reduce(
    (sum, item) => sum + Number(item.lineBaseSubtotal || 0),
    0
  );
  const discount = normalizedItems.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0);
  const subtotal = normalizedItems.reduce((sum, item) => sum + Number(item.lineSubtotal || 0), 0);
  const tax = normalizedItems.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0);
  const total = Number((subtotal + tax).toFixed(2));

  return {
    items: normalizedItems,
    preDiscountSubtotal: Number(preDiscountSubtotal.toFixed(2)),
    discount: Number(discount.toFixed(2)),
    subtotal: Number(subtotal.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total,
  };
}

async function getSales() {
  return salesRepository.getSales();
}

async function getSaleById(id) {
  const sale = await salesRepository.getSaleById(id);

  if (!sale) {
    throw new AppError(404, "Sale not found.", {
      code: "SALE_NOT_FOUND",
    });
  }

  return sale;
}

async function createSale(payload, actor) {
  const normalized = validateCreateSalePayload(payload);
  const customerProfile = await customerService.resolveCustomerCheckoutProfile({
    customerId: normalized.customerId,
    customerName: normalized.customer,
  });
  const customerDiscountPercent = customerProfile?.discountEligible
    ? Number(customerProfile.discountPercent || 0)
    : 0;
  const saleItems = [];

  for (const item of normalized.items) {
    const product = await salesRepository.getProductById(item.productId);

    if (!product) {
      throw new AppError(400, `Product not found for line ${item.productId}.`, {
        code: "SALE_PRODUCT_NOT_FOUND",
      });
    }

    if (normalized.status === "Paid" && Number(product.stock || 0) < Number(item.qty || 0)) {
      throw new AppError(400, `Insufficient stock for ${product.name}.`, {
        code: "INSUFFICIENT_STOCK",
      });
    }

    saleItems.push({
      id: product.id,
      name: product.name,
      sku: product.sku,
      qty: item.qty,
      price: Number(product.price || 0),
      unitCost: Number(product.unitCost || 0),
      taxClass: product.taxClass,
      taxCode: product.taxCode,
      taxLabel: product.taxLabel,
      taxRate: Number(product.taxRate || 0),
      isTaxable: Boolean(product.isTaxable),
      discountPercent: customerDiscountPercent,
    });
  }

  const totals = computeSaleTotals(saleItems, customerDiscountPercent);
  const createdSale = await salesRepository.createSale({
    id: await salesRepository.getNextSaleId(),
    items: totals.items,
    ...totals,
    customerDiscountPercent,
    customerLoyaltyTier: String(customerProfile?.loyaltyTier || ""),
    customerLoyaltyNumber: String(customerProfile?.loyaltyNumber || ""),
    cashierUserId: actor?.id ?? null,
    cashier: String(actor?.fullName || actor?.staffId || "Front Desk").trim(),
    customerId: customerProfile?.id ?? normalized.customerId ?? null,
    customer: customerProfile?.name || normalized.customer || "Walk-in Customer",
    status: normalized.status,
    channel: normalized.channel,
    paymentMethod: normalized.paymentMethod,
    date: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "sale.created",
    entityType: "sale",
    entityId: String(createdSale.id),
    details: {
      status: createdSale.status,
      total: createdSale.total,
      lineCount: createdSale.items.length,
      paymentMethod: createdSale.paymentMethod,
      channel: createdSale.channel,
    },
  });

  return createdSale;
}

async function updateSaleStatus(id, payload, actor) {
  const existing = await getSaleById(id);
  const { status, note } = validateSaleStatusPayload(payload);
  const nextStatus = normalizeStatus(status);

  const allowedTransitions = {
    Pending: new Set(["Paid", "Declined"]),
    Paid: new Set(["Refunded"]),
    Declined: new Set([]),
    Refunded: new Set([]),
  };

  if (nextStatus === "Refunded" && !["Owner", "Manager"].includes(String(actor?.role || ""))) {
    throw new AppError(403, "Only owners and managers can refund an order.", {
      code: "REFUND_NOT_ALLOWED",
    });
  }

  if (String(existing.status || "").trim() !== nextStatus) {
    const validNextStates = allowedTransitions[String(existing.status || "").trim()] || new Set();

    if (!validNextStates.has(nextStatus)) {
      throw new AppError(
        409,
        `Cannot change a ${existing.status} sale to ${nextStatus}.`,
        {
          code: "INVALID_SALE_STATUS_TRANSITION",
        }
      );
    }
  }

  const updatedSale = await salesRepository.updateSaleStatus(existing.id, nextStatus, {
    actorName: String(actor?.fullName || actor?.staffId || existing.cashier || "Front Desk").trim(),
    updatedAt: new Date().toISOString(),
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: nextStatus === "Refunded" ? "sale.refunded" : "sale.status_updated",
    entityType: "sale",
    entityId: String(updatedSale.id),
    details: {
      previousStatus: existing.status,
      nextStatus: updatedSale.status,
      total: updatedSale.total,
      note,
    },
  });

  return updatedSale;
}

module.exports = {
  getSales,
  getSaleById,
  createSale,
  updateSaleStatus,
};
