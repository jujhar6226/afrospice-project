const AppError = require("../errors/AppError");
const productRepository = require("../data/repositories/productRepository");
const auditLogService = require("./auditLogService");
const {
  validateProductPayload,
  validateRestockPayload,
} = require("../validation/productValidators");
const { assertCondition } = require("../validation/helpers");

async function getProducts() {
  return productRepository.getProducts();
}

async function getProductById(id) {
  const product = await productRepository.getProductById(id);

  if (!product) {
    throw new AppError(404, "Product not found.", {
      code: "PRODUCT_NOT_FOUND",
    });
  }

  return product;
}

async function getRecentInventoryMovements(limit = 8) {
  const normalizedLimit = Number(limit);
  return productRepository.getRecentInventoryMovements(
    Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 8
  );
}

async function getProductMovements(id, limit = 12) {
  const product = await getProductById(id);
  const normalizedLimit = Number(limit);

  return productRepository.getProductMovements(
    product.id,
    Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 12
  );
}

async function createProduct(payload, actor) {
  const nextId = await productRepository.getNextProductId();
  const product = validateProductPayload({
    ...(payload || {}),
    id: nextId,
  });

  assertCondition(
    !(await productRepository.findProductByName(product.name)),
    "A product with this name already exists."
  );
  assertCondition(
    !(await productRepository.findProductBySku(product.sku)),
    "A product with this SKU already exists."
  );

  if (product.barcode) {
    assertCondition(
      !(await productRepository.findProductByBarcode(product.barcode)),
      "A product with this barcode already exists."
    );
  }

  const createdProduct = await productRepository.createProduct({
    id: nextId,
    ...product,
  });

  if (Number(createdProduct.stock || 0) > 0) {
    await productRepository.recordInventoryMovement({
      productId: createdProduct.id,
      movementType: "create",
      quantityDelta: Number(createdProduct.stock || 0),
      quantityBefore: 0,
      quantityAfter: Number(createdProduct.stock || 0),
      referenceType: "product",
      referenceId: String(createdProduct.id),
      note: "New inventory line created.",
      actorName: String(actor?.fullName || actor?.staffId || "System").trim(),
    });
  }

  await auditLogService.recordAuditEvent({
    actor,
    action: "product.created",
    entityType: "product",
    entityId: String(createdProduct.id),
    details: {
      sku: createdProduct.sku,
      stock: createdProduct.stock,
      category: createdProduct.category,
    },
  });

  return createdProduct;
}

async function updateProduct(id, payload, actor) {
  const existing = await getProductById(id);
  const hasTaxClassPatch = Object.prototype.hasOwnProperty.call(payload || {}, "taxClass");
  const product = validateProductPayload({
    name: payload?.name ?? existing.name,
    sku: payload?.sku ?? existing.sku,
    barcode: payload?.barcode ?? existing.barcode,
    price: payload?.price ?? existing.price,
    unitCost: payload?.unitCost ?? existing.unitCost,
    stock: payload?.stock ?? existing.stock,
    category: payload?.category ?? existing.category,
    supplier: payload?.supplier ?? existing.supplier,
    ...(hasTaxClassPatch ? { taxClass: payload?.taxClass } : {}),
  });

  assertCondition(
    !(await productRepository.findProductByName(product.name, existing.id)),
    "A product with this name already exists."
  );
  assertCondition(
    !(await productRepository.findProductBySku(product.sku, existing.id)),
    "A product with this SKU already exists."
  );

  if (product.barcode) {
    assertCondition(
      !(await productRepository.findProductByBarcode(product.barcode, existing.id)),
      "A product with this barcode already exists."
    );
  }

  const updatedProduct = await productRepository.updateProduct(existing.id, {
    ...existing,
    ...product,
    ...(hasTaxClassPatch ? { taxClass: product.taxClass } : { taxClass: existing.taxClassOverride }),
  });

  const previousStock = Number(existing.stock || 0);
  const nextStock = Number(updatedProduct.stock || 0);

  if (previousStock !== nextStock) {
    await productRepository.recordInventoryMovement({
      productId: updatedProduct.id,
      movementType: "adjustment",
      quantityDelta: nextStock - previousStock,
      quantityBefore: previousStock,
      quantityAfter: nextStock,
      referenceType: "product",
      referenceId: String(updatedProduct.id),
      note: "Stock level adjusted from inventory management.",
      actorName: String(actor?.fullName || actor?.staffId || "System").trim(),
    });
  }

  await auditLogService.recordAuditEvent({
    actor,
    action: "product.updated",
    entityType: "product",
    entityId: String(updatedProduct.id),
    details: {
      previousStock,
      nextStock,
      sku: updatedProduct.sku,
    },
  });

  return updatedProduct;
}

async function deleteProduct(id, actor) {
  await getProductById(id);

  try {
    const deleted = await productRepository.deleteProduct(id);

    await auditLogService.recordAuditEvent({
      actor,
      action: "product.deleted",
      entityType: "product",
      entityId: String(deleted.id),
      details: {
        sku: deleted.sku,
        stock: deleted.stock,
      },
    });

    return deleted;
  } catch (error) {
    throw new AppError(
      409,
      "This product cannot be deleted because it is referenced by existing business records.",
      {
        code: "PRODUCT_DELETE_CONFLICT",
      }
    );
  }
}

async function restockProduct(id, payload, actor) {
  const existing = await getProductById(id);
  const { amount, note } = validateRestockPayload(payload);
  const restockedProduct = await productRepository.restockProductWithMovement(existing.id, amount, {
    movementType: "restock",
    referenceType: "product",
    referenceId: String(existing.id),
    note: note || "Manual restock recorded.",
    actorName: String(actor?.fullName || actor?.staffId || "System").trim(),
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "inventory.restocked",
    entityType: "product",
    entityId: String(restockedProduct.id),
    details: {
      amount,
      previousStock: existing.stock,
      nextStock: restockedProduct.stock,
      note,
    },
  });

  return restockedProduct;
}

async function getProductByBarcode(code) {
  const product = await productRepository.findProductByBarcode(code);

  if (!product) {
    throw new AppError(404, "Product not found.", {
      code: "PRODUCT_NOT_FOUND",
    });
  }

  return product;
}

module.exports = {
  getProducts,
  getProductById,
  getRecentInventoryMovements,
  getProductMovements,
  createProduct,
  updateProduct,
  deleteProduct,
  restockProduct,
  getProductByBarcode
};
