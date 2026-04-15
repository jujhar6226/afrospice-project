const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ENGINE_SCRIPT_PATH = path.join(__dirname, "..", "ml", "operational_ml_engine.py");
const CACHE_TTL_MS = 30 * 1000;
const cachedResponses = new Map();
let pythonBridgeUnavailable = false;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolvePythonCommands() {
  const explicit = String(process.env.PYTHON_ML_BIN || "").trim();
  const candidates = [];

  if (explicit) {
    candidates.push([explicit]);
  }

  if (process.platform === "win32") {
    candidates.push(
      ["C:\\Python314\\python.exe"],
      ["C:\\WINDOWS\\py.exe", "-3"],
      ["C:\\WINDOWS\\py.exe"],
      ["python.exe"],
      ["py.exe", "-3"],
      ["py.exe"]
    );
  }

  return [...candidates, ["py", "-3"], ["python"], ["python3"]];
}

function getCacheKey(options, snapshot) {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        options,
        snapshot,
      })
    )
    .digest("hex");
}

function getCachedResponse(cacheKey) {
  const cached = cachedResponses.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    cachedResponses.delete(cacheKey);
    return null;
  }

  return cached.data;
}

function setCachedResponse(cacheKey, data) {
  cachedResponses.set(cacheKey, {
    createdAt: Date.now(),
    data,
  });
}

function buildSerializableSnapshot(context) {
  return {
    latestObservedAt:
      context.latestObservedAt instanceof Date
        ? context.latestObservedAt.toISOString()
        : String(context.latestObservedAt || ""),
    currency: String(context.currency || "CAD").toUpperCase(),
    settings: {
      lowStockThreshold: toNumber(context.settings?.lowStockThreshold, 10),
    },
    products: (Array.isArray(context.products) ? context.products : []).map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      supplier: product.supplier,
      stock: toNumber(product.stock),
      price: toNumber(product.price),
      unitCost: toNumber(product.unitCost),
    })),
    sales: (Array.isArray(context.sales) ? context.sales : []).map((sale) => ({
      id: sale.id,
      status: sale.status,
      total: toNumber(sale.total),
      subtotal: toNumber(sale.subtotal),
      tax: toNumber(sale.tax),
      paymentMethod: sale.paymentMethod,
      channel: sale.channel,
      cashier: sale.cashier,
      customer: sale.customer,
      date: sale.date,
      createdAt: sale.createdAt,
      updatedAt: sale.updatedAt,
      items: (Array.isArray(sale.items) ? sale.items : []).map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        qty: toNumber(item.qty),
        price: toNumber(item.price),
        unitCost: toNumber(item.unitCost),
        lineTotal: toNumber(item.lineTotal),
        lineCost: toNumber(item.lineCost),
        category: item.category,
        supplier: item.supplier,
      })),
    })),
    purchaseOrders: (Array.isArray(context.purchaseOrders) ? context.purchaseOrders : []).map(
      (order) => ({
        id: order.id,
        supplier: order.supplier,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        expectedDate: order.expectedDate || order.expectedDateObj || null,
        sentAt: order.sentAt || order.sentAtObj || null,
        receivedAt: order.receivedAt || order.receivedAtObj || null,
        totalEstimatedCost: toNumber(order.totalEstimatedCost),
        openUnits: toNumber(order.openUnits),
        items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
          productId: item.productId,
          productName: item.productName || item.name,
          sku: item.sku,
          qtyOrdered: toNumber(item.qtyOrdered ?? item.qty ?? item.unitsRequested),
          qtyReceived: toNumber(item.qtyReceived),
          unitCost: toNumber(item.unitCost ?? item.cost ?? item.price),
        })),
      })
    ),
    inventoryMovements: (
      Array.isArray(context.inventoryMovements) ? context.inventoryMovements : []
    ).map((movement) => ({
      id: movement.id,
      productId: movement.productId,
      productName: movement.productName,
      sku: movement.sku,
      movementType: movement.movementType,
      quantityDelta: toNumber(movement.quantityDelta),
      quantityAfter: toNumber(movement.quantityAfter),
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      note: movement.note,
      createdAt: movement.createdAt,
    })),
    cycleCounts: (Array.isArray(context.cycleCounts) ? context.cycleCounts : []).map((count) => ({
      id: count.id,
      status: count.status,
      scope: count.scope,
      createdAt: count.createdAt,
      updatedAt: count.updatedAt,
      items: (Array.isArray(count.items) ? count.items : []).map((item) => ({
        productId: item.productId,
        productName: item.productName || item.name,
        sku: item.sku,
        expectedQty: toNumber(item.expectedQty),
        countedQty: toNumber(item.countedQty),
        varianceQty: toNumber(item.varianceQty),
      })),
    })),
    customers: (Array.isArray(context.customers) ? context.customers : []).map((customer) => ({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    })),
    suppliers: (Array.isArray(context.suppliers) ? context.suppliers : []).map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    })),
    users: (Array.isArray(context.users) ? context.users : []).map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })),
  };
}

function isValidPythonOutput(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      typeof payload.modelFamily === "string" &&
      payload.overview &&
      Array.isArray(payload.periods) &&
      Array.isArray(payload.skuForecasts)
  );
}

function unwrapPythonOutput(payload) {
  if (isValidPythonOutput(payload)) {
    return payload;
  }

  if (
    payload &&
    typeof payload === "object" &&
    payload.success === true &&
    isValidPythonOutput(payload.data)
  ) {
    return payload.data;
  }

  return null;
}

function executePythonEngine(payload) {
  if (pythonBridgeUnavailable || String(process.env.PYTHON_ML_DISABLE || "").trim() === "true") {
    return null;
  }

  if (!fs.existsSync(ENGINE_SCRIPT_PATH)) {
    return null;
  }

  const input = JSON.stringify(payload);
  const candidates = resolvePythonCommands();

  for (const [command, ...commandArgs] of candidates) {
    try {
      const stdout = execFileSync(command, [...commandArgs, ENGINE_SCRIPT_PATH], {
        cwd: path.join(__dirname, ".."),
        input,
        encoding: "utf8",
        timeout: 12000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = JSON.parse(String(stdout || "").trim() || "{}");

      const unwrapped = unwrapPythonOutput(parsed);
      if (unwrapped) {
        return unwrapped;
      }
    } catch (error) {
      if (String(error?.message || "").includes("EPERM")) {
        pythonBridgeUnavailable = true;
      }
      continue;
    }
  }

  return null;
}

function getOperationalModelOutputs(options = {}, context) {
  const snapshot = buildSerializableSnapshot(context);
  const cacheKey = getCacheKey(options, snapshot);
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return cached;
  }

  const payload = {
    options,
    context: snapshot,
  };
  const result = executePythonEngine(payload);

  if (result) {
    setCachedResponse(cacheKey, result);
  }

  return result;
}

module.exports = {
  getOperationalModelOutputs,
};
