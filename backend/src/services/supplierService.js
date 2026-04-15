const AppError = require("../errors/AppError");
const supplierRepository = require("../data/repositories/supplierRepository");
const auditLogService = require("./auditLogService");
const {
  validateSupplierListQuery,
  validateSupplierPayload,
} = require("../validation/supplierValidators");
const { assertCondition } = require("../validation/helpers");

function matchesSupplierSearch(supplier, search) {
  if (!search) return true;
  const haystack = [
    supplier.name,
    supplier.contactName,
    supplier.email,
    supplier.phone,
    supplier.notes,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

async function getSuppliers(query = {}) {
  const filters = validateSupplierListQuery(query);
  const suppliers = await supplierRepository.getSuppliers();

  return suppliers.filter((supplier) => matchesSupplierSearch(supplier, filters.search));
}

async function getSupplierById(id) {
  const supplier = await supplierRepository.getSupplierById(id);

  if (!supplier) {
    throw new AppError(404, "Supplier not found.", {
      code: "SUPPLIER_NOT_FOUND",
    });
  }

  return supplier;
}

async function createSupplier(payload, actor) {
  const supplier = validateSupplierPayload(payload);

  assertCondition(
    !(await supplierRepository.findSupplierByName(supplier.name)),
    "A supplier with this name already exists."
  );

  const createdSupplier = await supplierRepository.createSupplier(supplier);

  await auditLogService.recordAuditEvent({
    actor,
    action: "supplier.created",
    entityType: "supplier",
    entityId: String(createdSupplier.id),
    details: {
      name: createdSupplier.name,
      contactName: createdSupplier.contactName,
      isActive: createdSupplier.isActive,
    },
  });

  return createdSupplier;
}

async function updateSupplier(id, payload, actor) {
  const existing = await getSupplierById(id);
  const supplier = validateSupplierPayload({
    ...existing,
    ...(payload || {}),
  });

  assertCondition(
    !(await supplierRepository.findSupplierByName(supplier.name, existing.id)),
    "A supplier with this name already exists."
  );

  const updatedSupplier = await supplierRepository.updateSupplier(existing.id, {
    ...existing,
    ...supplier,
  });

  await auditLogService.recordAuditEvent({
    actor,
    action: "supplier.updated",
    entityType: "supplier",
    entityId: String(updatedSupplier.id),
    details: {
      previousName: existing.name,
      nextName: updatedSupplier.name,
      isActive: updatedSupplier.isActive,
    },
  });

  return updatedSupplier;
}

async function deleteSupplier(id, actor) {
  const existing = await getSupplierById(id);

  try {
    const deletedSupplier = await supplierRepository.deleteSupplier(existing.id);

    await auditLogService.recordAuditEvent({
      actor,
      action: "supplier.deleted",
      entityType: "supplier",
      entityId: String(deletedSupplier.id),
      details: {
        name: deletedSupplier.name,
      },
    });

    return deletedSupplier;
  } catch (error) {
    if (!/referenced by existing records/i.test(String(error?.message || ""))) {
      throw error;
    }

    throw new AppError(
      409,
      "This supplier cannot be deleted because it is referenced by existing business records.",
      {
        code: "SUPPLIER_DELETE_CONFLICT",
      }
    );
  }
}

module.exports = {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
};
